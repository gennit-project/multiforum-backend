import assert from "node:assert/strict";
import { before, beforeEach, after, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";
import getCustomResolvers from "../helpers/getTestResolvers.js";
import typeDefs from "../../typeDefs.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { createChannelPipelineRepository } from "../../services/persistence/channelPipelineRepository.js";
import { createSubscriptionEngine } from "../../services/subscriptionEngine.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";
let driver: Driver;
let app: ReturnType<typeof getCustomResolvers>;
const engine=createSubscriptionEngine();let events:unknown[]=[];
for(const kind of ["create","update","delete_relationship"]) engine.events.on(kind,(event: unknown)=>events.push(event));
before(async()=>{
  driver=await startNeo4j();app=getCustomResolvers(driver);
  const neo=new Neo4jGraphQL({typeDefs,driver,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine}});
  const schema=await neo.getSchema();registerGeneratedSchema(driver,schema);
},{timeout:240000});
beforeEach(async()=>{await resetDatabase(driver);events=[];});
after(async()=>{await engine.close();await stopNeo4j();});
const normalize=(value:unknown):unknown=>JSON.parse(JSON.stringify(value,(key,value)=>["timestamp","id","id_from","id_to"].includes(key)?`<${key}>`:value));
const seed=async(valid=true)=>driver.executeQuery(`CREATE (c:Channel {uniqueName:'cats',createdAt:datetime('2026-01-01T00:00:00Z'),pluginPipelines:'[]'})-[:BOT]->(u:User {username:'bot-old',createdAt:datetime('2026-01-01T00:00:00Z')}) CREATE (c)-[:BOT]->(:User {username:'human',createdAt:datetime('2026-01-01T00:00:00Z')}) CREATE (:ServerConfig {serverName:'server'}) ${valid?'':'REMOVE u.createdAt'}`);
const state=async()=>({rows:(await driver.executeQuery("MATCH (u:User) OPTIONAL MATCH (c:Channel)-[:BOT]->(u) RETURN u.username AS username,u.isDeprecated AS deprecated,u.deprecatedReason AS reason,c.uniqueName AS channel ORDER BY username")).records.map(r=>r.toObject()),events:normalize(events)});
test("channel and server snapshots plus pipeline writes preserve exact projections and native events",async(t)=>{
  await seed();const repo=createChannelPipelineRepository(driver);
  await driver.executeQuery(`MATCH (c:Channel),(s:ServerConfig)
    CREATE (p:Plugin {id:'scanner',name:'scanner',tags:['bots']})-[:HAS_VERSION]->(v:PluginVersion {id:'version',version:'1.0',settingsDefaults:'{"server":{"botName":"Default"}}'})
    CREATE (c)-[:ENABLED {enabled:true,settingsJson:'{"botName":"Channel"}'}]->(v)
    CREATE (s)-[:INSTALLED {enabled:true,settingsJson:'{"botName":"Server"}'}]->(v)`);
  t.assert.snapshot(await repo.findSettings("cats"));
  t.assert.snapshot(await repo.listServerSettings());
  // The driver repo write emits native subscription events directly; snapshot
  // them in place of the removed OGM parity comparison.
  events=[];await repo.savePipelines("cats",'[{"event":"comment.created"}]');t.assert.snapshot(normalize(events));
});
test("deprecation and disconnection preserve graph writes and native relationship events",async(t)=>{
  await seed();const reason='Bot profile removed from channel "cats"';
  // Snapshot the driver repo's graph writes and native events directly, in
  // place of the removed OGM parity baseline.
  events=[];const repo=createChannelPipelineRepository(driver);await repo.deprecateBot("bot-old",reason);await repo.disconnectBots("cats",["bot-old"]);t.assert.snapshot(await state());
});
test("wired channel mutation deprecates only orphan bots; failed deprecation remains caught after committed writes",async()=>{
  await seed();const pipelines=[{event:"comment.created",steps:[{pluginId:"scanner"}]}];
  assert.deepEqual(await app.resolvers.Mutation.updateChannelPluginPipelines(null,{channelUniqueName:"cats",pipelines},{},{}),pipelines);
  let rows=(await state()).rows;assert.equal(rows.find(r=>r.username==="bot-old")?.channel,null);assert.equal(rows.find(r=>r.username==="human")?.channel,"cats");
  await resetDatabase(driver);await seed(false);events=[];
  assert.deepEqual(await app.resolvers.Mutation.updateChannelPluginPipelines(null,{channelUniqueName:"cats",pipelines},{},{}),pipelines);
  rows=(await state()).rows;assert.equal(rows.find(r=>r.username==="bot-old")?.deprecated,true);assert.equal(rows.find(r=>r.username==="bot-old")?.channel,"cats");
  assert.equal((await createChannelPipelineRepository(driver).findSettings("cats"))[0].pluginPipelines,JSON.stringify(pipelines));
});
