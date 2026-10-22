import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { parse, print, GraphQLObjectType, type GraphQLSchema } from "graphql";
import { Neo4jGraphQL } from "@neo4j/graphql";
import neo4j, { type Driver, type SessionConfig } from "neo4j-driver";
import getCustomResolvers from "../helpers/getTestResolvers.js";
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
 assert.doesNotMatch(REGISTRATION_USER_SELECTION,/dateOfBirth/);
});

test("existence reads preserve missing/case-sensitive matches, projection and session routing",async(t)=>{
 for(const username of ["missing","alice"]){
  if(username==="alice") await ogm.model("User").create({input:[input()]});
  t.assert.snapshot({users:normalize(await repository.findExistingUsername(username)),session:sessions[sessions.length-1]});
 }
 for(const address of ["Alice@Example.test","alice@example.test","missing"]){
  t.assert.snapshot({emails:normalize(await repository.findExistingEmail(address)),session:sessions[sessions.length-1]});
 }
});

test("nested account creation preserves birthday, graph and native event ordering",async(t)=>{
 await repository.createAccount(input());
 t.assert.snapshot({graph:await graph(),events:normalize(events),session:sessions[sessions.length-1]});
 assert.ok(events.length>0);
 assert.deepEqual((await graph())[0],{username:"alice",birthday:"2000-01-01",email:"Alice@Example.test",moderator:"alice_mod"});
 t.assert.snapshot(plain(await repository.findCreatedAccount("alice")));
 assert.deepEqual(await repository.findCreatedAccount("missing"),[]);
});

test("generated input coercion errors precede graph writes/events",async()=>{
 const cases:[any,RegExp][]=[[{username:23},/String cannot represent a non string value/],[{...input(),Email:{create:{node:{address:23}}}},/String cannot represent a non string value/],[{...input(),dateOfBirth:"invalid"},/Date cannot represent non temporal value/]];
 for(const [malformed,message] of cases){
  await assert.rejects(repository.createAccount(malformed as never),message);
  assert.deepEqual(await graph(),[]);assert.deepEqual(events,[]);
 }
});

test("default existence read still rejects malformed selected fields",async()=>{
 await driver.executeQuery("CREATE (:User {username:'alice',createdAt:datetime(),notifyWhenTagged:'invalid'})");
 await assert.rejects(repository.findExistingUsername("alice"),/Boolean cannot represent a non boolean value/);
});

test("own account summary preserves the production internal selection and first errors",async(t)=>{
 for(const stage of ["missing","created","notifications"]){
  if(stage==="created") await repository.createAccount(input());
  if(stage==="notifications") await driver.executeQuery(`MATCH (u:User {username:'alice'})
   CREATE (u)-[:HAS_NOTIFICATION]->(:Notification {id:'unread',read:false,createdAt:datetime()})
   CREATE (u)-[:HAS_NOTIFICATION]->(:Notification {id:'read',read:true,createdAt:datetime()})`);
  t.assert.snapshot(await outcome(()=>repository.findOwnAccountSummary("Alice@Example.test")));
 }
});


test("creation projection failure preserves committed graph and native events",async(t)=>{
 const userType=schema.getType("User");
 assert.ok(userType instanceof GraphQLObjectType);
 const field=userType.getFields().variantUrls;
 const original=field.resolve;
 field.resolve=()=>{throw new Error("injected projection failure");};
 try {
  await assert.rejects(repository.createAccount(input()),{message:"injected projection failure"});
  const result={graph:await graph(),events:normalize(events)};
  assert.equal(result.graph.length,1);assert.ok(events.length>0);
  t.assert.snapshot(result);
 } finally {field.resolve=original;}
});
