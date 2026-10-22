import assert from "node:assert/strict";
import { before, beforeEach, after, test } from "node:test";
import { parse, print } from "graphql";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";
import getCustomResolvers from "../helpers/getTestResolvers.js";
import typeDefs from "../../typeDefs.js";
import { initializeOgmFromExistingSchema } from "../../services/initializeOgmFromExistingSchema.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { createForumOwnerRepository } from "../../services/persistence/forumOwnerRepository.js";
import acceptOwnerInvite from "../../customResolvers/mutations/acceptForumOwnerInvite.js";
import becomeForumAdmin from "../../customResolvers/mutations/becomeForumAdmin.js";
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
const snapshot=async()=>({events:normalize(events),graph:(await driver.executeQuery("MATCH (u:User) OPTIONAL MATCH (u)-[a:ADMIN_OF_CHANNEL]->(:Channel) OPTIONAL MATCH (:Channel)-[i:HAS_PENDING_INVITE]->(u) RETURN u.username AS username,count(DISTINCT a) AS admins,count(DISTINCT i) AS invites ORDER BY username")).records.map(r=>JSON.parse(JSON.stringify(r.toObject())))});
const seed=async(valid=true)=>{
 await driver.executeQuery("CREATE (:User {username:'alice',createdAt:datetime('2020-01-01T00:00:00Z')}) CREATE (:Channel {uniqueName:'cats',createdAt:datetime('2020-01-01T00:00:00Z')})");
 if(!valid)await driver.executeQuery("MATCH (c:Channel) REMOVE c.createdAt");
};
const plain=(x:unknown)=>JSON.parse(JSON.stringify(x));
const oldWrite=(action:"connectOwner"|"disconnectOwner"|"disconnectInvite",username:unknown="alice")=>ogm.model("Channel").update({where:{uniqueName:"cats"},update:action==="disconnectInvite"?{PendingOwnerInvites:[{disconnect:[{where:{node:{username}}}]}]}:{Admins:[{[action==="connectOwner"?"connect":"disconnect"]:[{where:{node:{username}}}]}]}} as any);
test("owner reads preserve missing results, nested recipients and generated limits",async()=>{
 const repo=createForumOwnerRepository(driver);
 const compare=async()=>{
  assert.deepEqual(plain(await repo.findPendingInvites("cats")),plain(await ogm.model("Channel").find({where:{uniqueName:"cats"},selectionSet:"{PendingOwnerInvites {username}}"})));
  assert.deepEqual(plain(await repo.findAdmins("cats")),plain(await ogm.model("Channel").find({where:{uniqueName:"cats"},selectionSet:"{Admins {username}}"})));
 };
 await compare();await seed();
 await driver.executeQuery("MATCH (c:Channel) UNWIND range(0,29) AS i CREATE (u:User {username:toString(i)}) CREATE (c)-[:HAS_PENDING_INVITE]->(u) CREATE (u)-[:ADMIN_OF_CHANNEL]->(c)");
 await compare();assert.equal((await repo.findPendingInvites("cats"))[0].PendingOwnerInvites.length,25);
 assert.equal((await repo.findAdmins("cats"))[0].Admins.length,25);
});
for(const action of ["connectOwner","disconnectOwner","disconnectInvite"] as const)test(`${action} preserves repeated native event payloads and mutation results`,async()=>{
 const prepare=async()=>{
  await resetDatabase(driver);await seed();
  if(action==="disconnectOwner")await driver.executeQuery("MATCH (u:User),(c:Channel) CREATE (u)-[:ADMIN_OF_CHANNEL]->(c)");
  if(action==="disconnectInvite")await driver.executeQuery("MATCH (u:User),(c:Channel) CREATE (c)-[:HAS_PENDING_INVITE]->(u)");
  events=[];
 };
 await prepare();const oldResults=[plain(await oldWrite(action)),plain(await oldWrite(action))];const expected=await snapshot();
 await prepare();const repo=createForumOwnerRepository(driver);const results=[plain(await repo[action]("cats","alice")),plain(await repo[action]("cats","alice"))];
 assert.deepEqual(results,oldResults);assert.deepEqual(await snapshot(),expected);
});
test("projection failure preserves committed owner relationship and native events",async()=>{
 await seed(false);let message="";await assert.rejects(oldWrite("connectOwner"),error=>{message=(error as Error).message;return true;});const expected=await snapshot();
 await resetDatabase(driver);await seed(false);events=[];
 await assert.rejects(createForumOwnerRepository(driver).connectOwner("cats","alice"),{message});assert.deepEqual(await snapshot(),expected);
});
test("invalid inputs preserve first coercion error and do not write",async()=>{
 await seed();let message="";await assert.rejects(oldWrite("connectOwner",23),error=>{message=(error as Error).message;return true;});
 await assert.rejects(createForumOwnerRepository(driver).connectOwner("cats",23 as any),{message});assert.deepEqual(events,[]);
});
test("production resolver keeps first acceptance write committed when second write fails",async()=>{
 await seed();await driver.executeQuery("MATCH (u:User),(c:Channel) CREATE (c)-[:HAS_PENDING_INVITE]->(u)");
 const repo=createForumOwnerRepository(driver);
 const context={driver,user:{username:"alice"},forumOwnerRepository:{...repo,disconnectInvite:async()=>{throw new Error("second operation failed");}}} as unknown as GraphQLContext;
 assert.equal(await acceptOwnerInvite()(null,{channelUniqueName:"cats"},context,{} as GraphQLResolveInfo),false);
 assert.equal((await repo.findAdmins("cats"))[0].Admins[0].username,"alice");assert.equal((await repo.findPendingInvites("cats"))[0].PendingOwnerInvites[0].username,"alice");
});
test("production resolver accepts once and rejects repeat after invite removal",async()=>{
 await seed();await driver.executeQuery("MATCH (u:User),(c:Channel) CREATE (c)-[:HAS_PENDING_INVITE]->(u)");
 const context={driver,user:{username:"alice"}} as unknown as GraphQLContext;
 assert.equal(await acceptOwnerInvite()(null,{channelUniqueName:"cats"},context,{} as GraphQLResolveInfo),true);
 const eventCount=events.length;
 await assert.rejects(acceptOwnerInvite()(null,{channelUniqueName:"cats"},context,{} as GraphQLResolveInfo),{message:"No pending owner invite found for user alice in channel cats"});assert.equal(events.length,eventCount);
});
test("production become-admin resolver preserves actual zero-admin guard and registration wiring",async()=>{
 await seed();const context={driver,user:{username:"alice"}} as unknown as GraphQLContext;
 assert.equal(await becomeForumAdmin()(null,{channelUniqueName:"cats"},context,{} as GraphQLResolveInfo),true);
 await assert.rejects(becomeForumAdmin()(null,{channelUniqueName:"cats"},context,{} as GraphQLResolveInfo),{message:"Cannot become admin: this forum already has one or more admins"});
});

for(const absent of ["channel","user"] as const)test(`owner writes preserve missing ${absent} results and events`,async()=>{
 for(const action of ["connectOwner","disconnectOwner","disconnectInvite"] as const){
  const prepare=async()=>{await resetDatabase(driver);await seed();await driver.executeQuery(absent==="channel"?"MATCH (c:Channel) DETACH DELETE c":"MATCH (u:User) DETACH DELETE u");events=[];};
  await prepare();const expected=plain(await oldWrite(action));const oldSnapshot=await snapshot();
  await prepare();assert.deepEqual(plain(await createForumOwnerRepository(driver)[action]("cats","alice")),expected);assert.deepEqual(await snapshot(),oldSnapshot);
 }
});
