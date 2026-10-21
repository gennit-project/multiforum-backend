import assert from "node:assert/strict";
import { before, beforeEach, after, test } from "node:test";
import { parse, print } from "graphql";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";
import getCustomResolvers from "../helpers/getTestResolvers.js";
import typeDefs from "../../typeDefs.js";
import { initializeOgmFromExistingSchema } from "../../services/initializeOgmFromExistingSchema.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { createServerAdminRepository } from "../../services/persistence/serverAdminRepository.js";
import { SERVER_MEMBERSHIP_SELECTION } from "../../services/persistence/serverMembershipSelections.js";
import acceptAdminInvite from "../../customResolvers/mutations/acceptServerAdminInvite.js";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";
import { createSubscriptionEngine } from "../../services/subscriptionEngine.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";
let driver: Driver;
let ogm: ReturnType<typeof getCustomResolvers>["ogm"];
const engine = createSubscriptionEngine();
let events: unknown[] = [];
for (const kind of ["create", "update", "create_relationship", "delete_relationship", "delete"]) engine.events.on(kind, event => events.push(event));
before(async () => {
 driver = await startNeo4j();
 const app = getCustomResolvers(driver); ogm = app.ogm;
 const neoSchema = new Neo4jGraphQL({typeDefs,driver,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine}});
 const schema = await neoSchema.getSchema(); initializeOgmFromExistingSchema(ogm,neoSchema,schema); registerGeneratedSchema(driver,schema);
}, {timeout:240_000});
beforeEach(async () => {await resetDatabase(driver); events=[];});
after(async () => {await engine.close(); await stopNeo4j();});
const normalize = (value: unknown): unknown => {
 const identities = new Map<string,string>();
 return JSON.parse(JSON.stringify(value,function(key,value) {
  if (["id","id_from","id_to"].includes(key)) {
   const namespace = key === "id" && this.event?.includes("relationship") ? "relationship" : "node";
   const identity = `${namespace}:${value}`;
   if (!identities.has(identity)) identities.set(identity,`<id-${identities.size}>`);
   return identities.get(identity);
  }
  return ["timestamp","createdAt","updatedAt"].includes(key) ? "<generated-time>" : value;
 }));
};
const snapshot=async()=>({events:normalize(events),graph:(await driver.executeQuery("MATCH (u:User) OPTIONAL MATCH (u)-[a:ADMIN_OF_SERVER]->(:ServerConfig) OPTIONAL MATCH (:ServerConfig)-[i:HAS_PENDING_SERVER_ADMIN_INVITE]->(u) RETURN u.username AS username,count(DISTINCT a) AS admins,count(DISTINCT i) AS invites ORDER BY username")).records.map(r=>JSON.parse(JSON.stringify(r.toObject())))});
const seed=async(valid=true)=>{
 await driver.executeQuery("CREATE (:User {username:'alice',createdAt:datetime('2020-01-01T00:00:00Z')}) CREATE (:ServerConfig {serverName:'cats',createdAt:datetime('2020-01-01T00:00:00Z')})");
 if(!valid)await driver.executeQuery("MATCH (c:ServerConfig) SET c.enableEvents='invalid'");
};
const plain=(x:unknown)=>JSON.parse(JSON.stringify(x));
const oldWrite=(action:"connectAdmin"|"disconnectInvite",username:unknown="alice")=>ogm.model("ServerConfig").update({where:{serverName:"cats"},update:action==="disconnectInvite"?{PendingAdminInvites:[{disconnect:[{where:{node:{username}}}]}]}:{Admins:[{[action==="connectAdmin"?"connect":"disconnect"]:[{where:{node:{username}}}]}]}} as any);
test("ServerConfig default selection remains exact, including field ordering",()=>{
 assert.equal(print(parse(SERVER_MEMBERSHIP_SELECTION)),print(parse((ogm.model("ServerConfig") as unknown as {getSelectionSetOrDefault():string}).getSelectionSetOrDefault())));
});
test("administrator reads preserve missing results, nested recipients and generated limits",async()=>{
 const repo=createServerAdminRepository(driver);
 const compare=async()=>{
  assert.deepEqual(plain(await repo.findPendingInvites("cats")),plain(await ogm.model("ServerConfig").find({where:{serverName:"cats"},selectionSet:"{PendingAdminInvites {username}}"})));
 };
 await compare();await seed();
 await driver.executeQuery("MATCH (c:ServerConfig) UNWIND range(0,29) AS i CREATE (u:User {username:toString(i)}) CREATE (c)-[:HAS_PENDING_SERVER_ADMIN_INVITE]->(u) CREATE (u)-[:ADMIN_OF_SERVER]->(c)");
 await compare();assert.equal((await repo.findPendingInvites("cats"))[0].PendingAdminInvites.length,25);
});
for(const action of ["connectAdmin","disconnectInvite"] as const)test(`${action} preserves repeated native event payloads and mutation results`,async()=>{
 const prepare=async()=>{
  await resetDatabase(driver);await seed();
  if(action==="disconnectInvite")await driver.executeQuery("MATCH (u:User),(c:ServerConfig) CREATE (c)-[:HAS_PENDING_SERVER_ADMIN_INVITE]->(u)");
  events=[];
 };
 await prepare();const oldResults=[plain(await oldWrite(action)),plain(await oldWrite(action))];const expected=await snapshot();
 await prepare();const repo=createServerAdminRepository(driver);const results=[plain(await repo[action]("cats","alice")),plain(await repo[action]("cats","alice"))];
 assert.deepEqual(results,oldResults);assert.deepEqual(await snapshot(),expected);
});
test("projection failure preserves committed administrator relationship and native events",async()=>{
 await seed(false);let message="";await assert.rejects(oldWrite("connectAdmin"),error=>{message=(error as Error).message;return true;});const expected=await snapshot();
 await resetDatabase(driver);await seed(false);events=[];
 await assert.rejects(createServerAdminRepository(driver).connectAdmin("cats","alice"),{message});assert.deepEqual(await snapshot(),expected);
});
test("invalid inputs preserve first coercion error and do not write",async()=>{
 await seed();let message="";await assert.rejects(oldWrite("connectAdmin",23),error=>{message=(error as Error).message;return true;});
 await assert.rejects(createServerAdminRepository(driver).connectAdmin("cats",23 as any),{message});assert.deepEqual(events,[]);
});
test("production resolver keeps first acceptance write committed when second write fails",async()=>{
 await seed();await driver.executeQuery("MATCH (u:User),(c:ServerConfig) CREATE (c)-[:HAS_PENDING_SERVER_ADMIN_INVITE]->(u)");
 const repo=createServerAdminRepository(driver);
 const context={driver,user:{username:"alice"},serverAdminRepository:{...repo,disconnectInvite:async()=>{throw new Error("second operation failed");}}} as unknown as GraphQLContext;
 assert.equal(await acceptAdminInvite()(null,{serverName:"cats"},context,{} as GraphQLResolveInfo),false);
 assert.equal((await driver.executeQuery("MATCH (:User)-[a:ADMIN_OF_SERVER]->(:ServerConfig) RETURN count(a) AS count")).records[0].get("count").toNumber(),1);
 assert.equal((await repo.findPendingInvites("cats"))[0].PendingAdminInvites[0].username,"alice");
});
test("production resolver accepts once and rejects repeat after invite removal",async()=>{
 await seed();await driver.executeQuery("MATCH (u:User),(c:ServerConfig) CREATE (c)-[:HAS_PENDING_SERVER_ADMIN_INVITE]->(u)");
 const context={driver,user:{username:"alice"}} as unknown as GraphQLContext;
 assert.equal(await acceptAdminInvite()(null,{serverName:"cats"},context,{} as GraphQLResolveInfo),true);
 const eventCount=events.length;
 await assert.rejects(acceptAdminInvite()(null,{serverName:"cats"},context,{} as GraphQLResolveInfo),{message:"No pending admin invite found for user alice"});assert.equal(events.length,eventCount);
});

for(const absent of ["server","user"] as const)test(`administrator writes preserve missing ${absent} results and events`,async()=>{
 for(const action of ["connectAdmin","disconnectInvite"] as const){
  const prepare=async()=>{await resetDatabase(driver);await seed();await driver.executeQuery(absent==="server"?"MATCH (c:ServerConfig) DETACH DELETE c":"MATCH (u:User) DETACH DELETE u");events=[];};
  await prepare();const expected=plain(await oldWrite(action));const oldSnapshot=await snapshot();
  await prepare();assert.deepEqual(plain(await createServerAdminRepository(driver)[action]("cats","alice")),expected);assert.deepEqual(await snapshot(),oldSnapshot);
 }
});