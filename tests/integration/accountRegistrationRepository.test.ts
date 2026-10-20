import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { parse, print, GraphQLObjectType, type GraphQLSchema } from "graphql";
import { Neo4jGraphQL } from "@neo4j/graphql";
import neo4j, { type Driver, type SessionConfig } from "neo4j-driver";
import getCustomResolvers from "../../customResolvers.js";
import typeDefs from "../../typeDefs.js";
import { initializeOgmFromExistingSchema } from "../../services/initializeOgmFromExistingSchema.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { createAccountRegistrationRepository, REGISTRATION_USER_SELECTION } from "../../services/persistence/accountRegistrationRepository.js";
import { createSubscriptionEngine } from "../../services/subscriptionEngine.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";
let driver: Driver;
let schema: GraphQLSchema;
let ogm: ReturnType<typeof getCustomResolvers>["ogm"];
let repository: ReturnType<typeof createAccountRegistrationRepository>;
const engine = createSubscriptionEngine();
let events: unknown[] = [];
const sessions: SessionConfig[] = [];
for (const kind of ["create","update","create_relationship","delete_relationship","delete"]) engine.events.on(kind,event=>events.push(event));
before(async()=>{
 driver=await startNeo4j();
 const open=driver.session.bind(driver);
 driver.session=(config?:SessionConfig)=>{sessions.push(config??{});return open(config);};
 const app=getCustomResolvers(driver);ogm=app.ogm;
 const neoSchema=new Neo4jGraphQL({typeDefs,driver,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine}});
 schema=await neoSchema.getSchema(); initializeOgmFromExistingSchema(ogm,neoSchema,schema);registerGeneratedSchema(driver,schema);
 repository=createAccountRegistrationRepository(driver);
},{timeout:240_000});
beforeEach(async()=>{await resetDatabase(driver);events=[];sessions.length=0;});
after(async()=>{await engine.close();await stopNeo4j();});
const plain=(value:unknown)=>JSON.parse(JSON.stringify(value));
const outcome=async(work:()=>Promise<unknown>)=>work().then(value=>({value:plain(value)}),(error:Error)=>({error:error.message}));
const input=()=>({username:"alice",dateOfBirth:new neo4j.types.Date(2000,1,1),
 Email:{create:{node:{address:"Alice@Example.test"}}},ModerationProfile:{create:{node:{displayName:"alice_mod"}}}});
const normalize=(value:unknown):unknown=>{
 const identities=new Map<string,string>();
 return JSON.parse(JSON.stringify(value,function(key,value){
  if(["id","id_from","id_to"].includes(key)){
   const namespace=key==="id"&&this.event?.includes("relationship")?"relationship":"node";
   const identity=`${namespace}:${value}`;
   if(!identities.has(identity)) identities.set(identity,`<id-${identities.size}>`);
   return identities.get(identity);
  }
  return ["timestamp","createdAt","updatedAt"].includes(key)?"<generated-time>":value;
 }));
};
const graph=async()=>plain((await driver.executeQuery(`MATCH (u:User)
 OPTIONAL MATCH (u)<-[:HAS_EMAIL]-(e:Email)
 OPTIONAL MATCH (u)-[:MODERATION_PROFILE]->(m:ModerationProfile)
 RETURN u.username AS username,toString(u.dateOfBirth) AS birthday,e.address AS email,m.displayName AS moderator
 ORDER BY username`)).records.map(r=>r.toObject()));

test("registration default selections match OGM exactly including hidden-field exclusion",()=>{
 const userSelection=(ogm.model("User") as unknown as {getSelectionSetOrDefault():string}).getSelectionSetOrDefault();
 assert.equal(print(parse(REGISTRATION_USER_SELECTION)),print(parse(userSelection)));
 const emailSelection=(ogm.model("Email") as unknown as {getSelectionSetOrDefault():string}).getSelectionSetOrDefault();
 assert.equal(print(parse("{address}")),print(parse(emailSelection)));
 assert.doesNotMatch(REGISTRATION_USER_SELECTION,/dateOfBirth/);
});

test("existence reads preserve missing/case-sensitive matches, projection and session routing",async()=>{
 for(const username of ["missing","alice"]){
  if(username==="alice") await ogm.model("User").create({input:[input()]});
  const expected=plain(await ogm.model("User").find({where:{username}}));
  const oldConfig=sessions[sessions.length-1];
  assert.deepEqual(plain(await repository.findExistingUsername(username)),expected);
  assert.deepEqual(sessions[sessions.length-1],oldConfig);
 }
 for(const address of ["Alice@Example.test","alice@example.test","missing"]){
  const expected=plain(await ogm.model("Email").find({where:{address}}));
  const oldConfig=sessions[sessions.length-1];
  assert.deepEqual(plain(await repository.findExistingEmail(address)),expected);
  assert.deepEqual(sessions[sessions.length-1],oldConfig);
 }
});

test("nested account creation preserves birthday, graph and native event ordering",async()=>{
 await ogm.model("User").create({input:[input()]});
 const oldConfig=sessions[sessions.length-1];
 const expected={graph:await graph(),events:normalize(events)};
 assert.ok(events.length>0);
 await resetDatabase(driver);events=[];
 await repository.createAccount(input());
 assert.deepEqual(sessions[sessions.length-1],oldConfig);
 assert.deepEqual({graph:await graph(),events:normalize(events)},expected);
 assert.deepEqual((await graph())[0],{username:"alice",birthday:"2000-01-01",email:"Alice@Example.test",moderator:"alice_mod"});
 const old=await ogm.model("User").find({where:{username:"alice"},selectionSet:"{username Email {address} ModerationProfile {displayName}}"});
 assert.deepEqual(plain(await repository.findCreatedAccount("alice")),plain(old));
 assert.deepEqual(await repository.findCreatedAccount("missing"),[]);
});

test("generated input coercion errors precede graph writes/events",async()=>{
 for(const malformed of [{username:23},{...input(),Email:{create:{node:{address:23}}}},{...input(),dateOfBirth:"invalid"}]){
  const old=await outcome(()=>ogm.model("User").create({input:[malformed as never]}));
  assert.ok("error" in old);
  const actual=await repository.createAccount(malformed as never).then(()=>({value:"unexpected success"}),(error:Error)=>({error:error.message}));
  assert.deepEqual(actual,old);
  assert.deepEqual(await graph(),[]);assert.deepEqual(events,[]);
 }
});

test("default existence read still rejects malformed selected fields",async()=>{
 await driver.executeQuery("CREATE (:User {username:'alice',createdAt:datetime(),notifyWhenTagged:'invalid'})");
 const expected=await outcome(()=>ogm.model("User").find({where:{username:"alice"}}));
 assert.ok("error" in expected);
 assert.deepEqual(await outcome(()=>repository.findExistingUsername("alice")),expected);
});

test("own account summary preserves the production internal selection and first errors",async()=>{
 const selectionSet="{address User {username profilePicURL ModerationProfile {displayName} NotificationsAggregate(where:{read:false}) {count}}}";
 for(const stage of ["missing","created","notifications"]){
  if(stage==="created") await repository.createAccount(input());
  if(stage==="notifications") await driver.executeQuery(`MATCH (u:User {username:'alice'})
   CREATE (u)-[:HAS_NOTIFICATION]->(:Notification {id:'unread',read:false,createdAt:datetime()})
   CREATE (u)-[:HAS_NOTIFICATION]->(:Notification {id:'read',read:true,createdAt:datetime()})`);
  const expected=await outcome(()=>ogm.model("Email").find({where:{address:"Alice@Example.test"},selectionSet}));
  assert.deepEqual(await outcome(()=>repository.findOwnAccountSummary("Alice@Example.test")),expected);
 }
});


test("creation projection failure preserves committed graph and native events",async()=>{
 const userType=schema.getType("User");
 assert.ok(userType instanceof GraphQLObjectType);
 const field=userType.getFields().variantUrls;
 const original=field.resolve;
 field.resolve=()=>{throw new Error("injected projection failure");};
 try {
  await assert.rejects(ogm.model("User").create({input:[input()]}),{message:"injected projection failure"});
  const expected={graph:await graph(),events:normalize(events)};
  assert.equal(expected.graph.length,1);assert.ok(events.length>0);
  await resetDatabase(driver);events=[];
  await assert.rejects(repository.createAccount(input()),{message:"injected projection failure"});
  assert.deepEqual({graph:await graph(),events:normalize(events)},expected);
 } finally {field.resolve=original;}
});
