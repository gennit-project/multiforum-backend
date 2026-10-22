import assert from "node:assert/strict";
import { before, beforeEach, after, test } from "node:test";
import { parse, print } from "graphql";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";
import getCustomResolvers from "../helpers/getTestResolvers.js";
import typeDefs from "../../typeDefs.js";
import { initializeOgmFromExistingSchema } from "../../services/initializeOgmFromExistingSchema.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { createForumModeratorRepository } from "../../services/persistence/forumModeratorRepository.js";
import acceptModInvite from "../../customResolvers/mutations/acceptForumModInvite.js";
import removeForumMod from "../../customResolvers/mutations/removeForumMod.js";
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
const snapshot=async()=>({events:normalize(events),graph:(await driver.executeQuery("MATCH (u:User) OPTIONAL MATCH (u)-[:MODERATION_PROFILE]->(p:ModerationProfile) OPTIONAL MATCH (p)-[m:MODERATOR_OF_CHANNEL]->(:Channel) OPTIONAL MATCH (:Channel)-[i:HAS_PENDING_MOD_INVITE]->(u) RETURN u.username AS username,count(DISTINCT m) AS moderators,count(DISTINCT i) AS invites ORDER BY username")).records.map(r=>JSON.parse(JSON.stringify(r.toObject())))});
const seed=async(valid=true)=>{
 await driver.executeQuery("CREATE (u:User {username:'alice',createdAt:datetime('2020-01-01T00:00:00Z')}) CREATE (:Channel {uniqueName:'cats',createdAt:datetime('2020-01-01T00:00:00Z')}) CREATE (p:ModerationProfile {displayName:'ModAlice'}) CREATE (u)-[:MODERATION_PROFILE]->(p)");
 if(!valid)await driver.executeQuery("MATCH (c:Channel) REMOVE c.createdAt");
};
const plain=(x:unknown)=>JSON.parse(JSON.stringify(x));
const oldWrite=(action:"connectModerator"|"disconnectModerator"|"disconnectInvite",identity:unknown=action==="disconnectInvite"?"alice":"ModAlice")=>ogm.model("Channel").update({where:{uniqueName:"cats"},update:action==="disconnectInvite"?{PendingModInvites:[{disconnect:[{where:{node:{username:identity}}}]}]}:{Moderators:[{[action==="connectModerator"?"connect":"disconnect"]:[{where:{node:{displayName:identity}}}]}]}} as any);
test("moderator reads preserve missing results, nested recipients and generated limits",async()=>{
 const repo=createForumModeratorRepository(driver);
 const compare=async()=>{
  assert.deepEqual(plain(await repo.findPendingInvites("cats")),plain(await ogm.model("Channel").find({where:{uniqueName:"cats"},selectionSet:"{PendingModInvites {username}}"})));
  assert.deepEqual(plain(await repo.findModeratorProfile("alice")),plain(await ogm.model("User").find({where:{username:"alice"},selectionSet:"{ModerationProfile {displayName}}"})));
 };
 await compare();await seed();
 await driver.executeQuery("MATCH (c:Channel) UNWIND range(0,29) AS i CREATE (u:User {username:toString(i)}) CREATE (c)-[:HAS_PENDING_MOD_INVITE]->(u)");
 await compare();assert.equal((await repo.findPendingInvites("cats"))[0].PendingModInvites.length,25);

});
for(const action of ["connectModerator","disconnectModerator","disconnectInvite"] as const)test(`${action} preserves repeated native event payloads and mutation results`,async()=>{
 const prepare=async()=>{
  await resetDatabase(driver);await seed();
  if(action==="disconnectModerator")await driver.executeQuery("MATCH (p:ModerationProfile),(c:Channel) CREATE (p)-[:MODERATOR_OF_CHANNEL]->(c)");
  if(action==="disconnectInvite")await driver.executeQuery("MATCH (u:User),(c:Channel) CREATE (c)-[:HAS_PENDING_MOD_INVITE]->(u)");
  events=[];
 };
 await prepare();const oldResults=[plain(await oldWrite(action)),plain(await oldWrite(action))];const expected=await snapshot();
 await prepare();const repo=createForumModeratorRepository(driver);const results=[plain(await repo[action]("cats",action==="disconnectInvite"?"alice":"ModAlice")),plain(await repo[action]("cats",action==="disconnectInvite"?"alice":"ModAlice"))];
 assert.deepEqual(results,oldResults);assert.deepEqual(await snapshot(),expected);
});
test("projection failure preserves committed moderator relationship and native events",async()=>{
 await seed(false);let message="";await assert.rejects(oldWrite("connectModerator"),error=>{message=(error as Error).message;return true;});const expected=await snapshot();
 await resetDatabase(driver);await seed(false);events=[];
 await assert.rejects(createForumModeratorRepository(driver).connectModerator("cats","ModAlice"),{message});assert.deepEqual(await snapshot(),expected);
});
test("invalid inputs preserve first coercion error and do not write",async()=>{
 await seed();let message="";await assert.rejects(oldWrite("connectModerator",23),error=>{message=(error as Error).message;return true;});
 await assert.rejects(createForumModeratorRepository(driver).connectModerator("cats",23 as any),{message});assert.deepEqual(events,[]);
});
test("production resolver keeps first acceptance write committed when second write fails",async()=>{
 await seed();await driver.executeQuery("MATCH (u:User),(c:Channel) CREATE (c)-[:HAS_PENDING_MOD_INVITE]->(u)");
 const repo=createForumModeratorRepository(driver);
 const context={driver,user:{username:"alice"},forumModeratorRepository:{...repo,disconnectInvite:async()=>{throw new Error("second operation failed");}}} as unknown as GraphQLContext;
 assert.equal(await acceptModInvite()(null,{channelUniqueName:"cats"},context,{} as GraphQLResolveInfo),false);
 assert.equal((await driver.executeQuery("MATCH (:ModerationProfile)-[m:MODERATOR_OF_CHANNEL]->(:Channel) RETURN count(m) AS count")).records[0].get("count").toNumber(),1);assert.equal((await repo.findPendingInvites("cats"))[0].PendingModInvites[0].username,"alice");
});
test("production resolver accepts once and rejects repeat after invite removal",async()=>{
 await seed();await driver.executeQuery("MATCH (u:User),(c:Channel) CREATE (c)-[:HAS_PENDING_MOD_INVITE]->(u)");
 const context={driver,user:{username:"alice"}} as unknown as GraphQLContext;
 assert.equal(await acceptModInvite()(null,{channelUniqueName:"cats"},context,{} as GraphQLResolveInfo),true);
 const eventCount=events.length;
 await assert.rejects(acceptModInvite()(null,{channelUniqueName:"cats"},context,{} as GraphQLResolveInfo),{message:"No pending moderator invite found for user alice in channel cats"});assert.equal(events.length,eventCount);
});
test("legacy moderator removal resolves the actual private profile and preserves repeated disconnect behavior",async()=>{
 await seed();await createForumModeratorRepository(driver).connectModerator("cats","ModAlice");
 const context={driver,user:{username:"alice"}} as unknown as GraphQLContext;
 assert.equal(await removeForumMod()(null,{channelUniqueName:"cats",username:"alice"},context,{} as GraphQLResolveInfo),true);
 assert.equal(await removeForumMod()(null,{channelUniqueName:"cats",modProfileName:"ModAlice"},context,{} as GraphQLResolveInfo),true);
});

for(const absent of ["channel","profile"] as const)test(`moderator writes preserve missing ${absent} results and events`,async()=>{
 for(const action of ["connectModerator","disconnectModerator","disconnectInvite"] as const){
  const prepare=async()=>{await resetDatabase(driver);await seed();await driver.executeQuery(absent==="channel"?"MATCH (c:Channel) DETACH DELETE c":"MATCH (p:ModerationProfile) DETACH DELETE p");events=[];};
  await prepare();const expected=plain(await oldWrite(action));const oldSnapshot=await snapshot();
  await prepare();assert.deepEqual(plain(await createForumModeratorRepository(driver)[action]("cats",action==="disconnectInvite"?"alice":"ModAlice")),expected);assert.deepEqual(await snapshot(),oldSnapshot);
 }
});
