import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { graphql, type GraphQLSchema } from "graphql";
import { applyMiddleware } from "graphql-middleware";
import type { Driver } from "neo4j-driver";
import typeDefs from "../../typeDefs.js";
import getResolvers from "../helpers/getTestResolvers.js";
import permissions from "../../permissions.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { startNeo4j, stopNeo4j, resetDatabase } from "./neo4jHarness.js";

let driver: Driver, schema: GraphQLSchema, secured: GraphQLSchema;
before(async () => {
  driver = await startNeo4j();
  schema = await new Neo4jGraphQL({ driver, typeDefs, resolvers: getResolvers(driver).resolvers,
    features: { filters: { String: { MATCHES: true } } } }).getSchema();
  registerGeneratedSchema(driver, schema);
  secured = applyMiddleware(schema, permissions);
}, { timeout: 240000 });
after(async () => stopNeo4j());
beforeEach(async () => resetDatabase(driver));
function execute(source: string, variableValues?: Record<string, unknown>, protect = false) {
  return graphql({ schema: protect ? secured : schema, source, variableValues,
    contextValue: { driver, req: { headers: {} }, mayAccessSensitiveContent: false } });
}
function data(result: Awaited<ReturnType<typeof execute>>) {
  assert.equal(result.errors, undefined);
  return JSON.parse(JSON.stringify(result.data));
}
const selected = "targetId targetType scope channelId configured required reason expectedJobs { pluginName version order }";
const applicable = (args = 'downloadableFileId:"file"', fields = selected) => `{ result:getApplicablePluginPipeline(${args}) { ${fields} } }`;
const serverMutation = 'mutation($pipelines:[EventPipelineInput!]!) { result:updatePluginPipelines(pipelines:$pipelines) }';
const channelMutation = 'mutation($pipelines:[EventPipelineInput!]!) { result:updateChannelPluginPipelines(channelUniqueName:"cats",pipelines:$pipelines) }';
async function seed(): Promise<void> {
  await driver.executeQuery(`
    CREATE (discussion:Discussion {id: 'discussion', deleted: false})
    CREATE (file:DownloadableFile {id: 'file', createdAt: datetime('2026-01-01T00:00:00Z'), uploadedAt: datetime('2026-01-02T00:00:00Z')})
    CREATE (discussion)-[:HAS_DOWNLOADABLE_FILE]->(file)
    CREATE (channel:Channel {uniqueName: 'cats', pluginPipelines: $channelPipelines})
    CREATE (post:DiscussionChannel {id: 'post', channelUniqueName: 'cats', archived: false})
    CREATE (post)-[:POSTED_IN_CHANNEL]->(discussion)
    CREATE (post)-[:POSTED_IN_CHANNEL]->(channel)
    CREATE (plugin:Plugin {id: 'scanner', name: 'scanner', displayName: 'Scanner'})
    CREATE (version:PluginVersion {id: 'version', version: '1.0.0', repoUrl: 'https://example.test/repo', entryPath: 'index.js', manifest: $manifest})
    CREATE (plugin)-[:HAS_VERSION]->(version)
    CREATE (:ServerConfig {serverName: 'server', pluginPipelines: $serverPipelines})-[:INSTALLED {enabled: true}]->(version)
  `, {
    channelPipelines: JSON.stringify([{ event: "discussionChannel.created", steps: [{ pluginId: "scanner" }] }]),
    serverPipelines: JSON.stringify([{ event: "downloadableFile.created", steps: [{ pluginId: "scanner" }] }]),
    manifest: JSON.stringify({ events: ["downloadableFile.created", "discussionChannel.created"] }),
  });
}


test("server and channel policy computed selections serialize ordered plugin jobs", async () => {
  await seed();
  const server = data(await execute(applicable())).result;
  assert.equal(server.targetId, "file"); assert.equal(server.targetType, "DownloadableFile");
  assert.equal(server.scope, "SERVER"); assert.equal(server.channelId, null);
  assert.equal(server.configured, true); assert.equal(server.required, true);
  assert.deepEqual(server.expectedJobs, [{pluginName:"Scanner",version:"1.0.0",order:0}]);
  const channel = data(await execute(applicable('downloadableFileId:"file",scope:"CHANNEL",discussionId:"discussion",channelUniqueName:"cats",eventType:"discussionChannel.created"'))).result;
  assert.equal(channel.targetId,"discussion");assert.equal(channel.targetType,"Discussion");assert.equal(channel.scope,"CHANNEL");assert.equal(channel.channelId,"cats");
  assert.deepEqual(channel.expectedJobs,server.expectedJobs);
});
test("empty channel policy produces an empty plan without server fallback", async () => {
  await seed(); await driver.executeQuery("MATCH(c:Channel) SET c.pluginPipelines='[]'");
  const result=data(await execute(applicable('downloadableFileId:"file",scope:"CHANNEL",discussionId:"discussion",channelUniqueName:"cats"'))).result;
  assert.equal(result.configured,false);assert.equal(result.required,false);assert.deepEqual(result.expectedJobs,[]);
});
test("nullable event input retains lazy String serialization instead of eager rejection", async () => {
  await seed();
  assert.equal(data(await execute(applicable('downloadableFileId:"file",eventType:null'))).result.scope,"SERVER");
  const result=await execute(applicable('downloadableFileId:"file",eventType:null','eventType'));
  assert.match(result.errors?.[0].message ?? "",/Cannot return null for non-nullable field ApplicablePluginPipeline.eventType/);
});
test("stored policy enum remains a selected-field runtime failure", async () => {
  await seed();
  await driver.executeQuery("MATCH(s:ServerConfig) SET s.pluginPipelines=$value",{value:JSON.stringify([{event:"downloadableFile.created",steps:[{pluginId:"scanner"}],applicability:"INVALID"}])});
  assert.equal(data(await execute(applicable())).result.configured,true);
  const result=await execute(applicable(undefined,'applicability'));
  assert.match(result.errors?.[0].message ?? "",/cannot represent value/);
});
test("invalid scope and missing channel context fail before reading absent targets", async () => {
  for(const args of ['downloadableFileId:"file",scope:null','downloadableFileId:"file",scope:"INVALID"','downloadableFileId:"file",scope:"CHANNEL"']) {
    const result=await execute(applicable(args));assert.equal(result.errors?.[0].extensions.code,"BAD_USER_INPUT");
  }
});
test("missing, removed, archived and mismatched targets retain visibility failures", async () => {
  assert.equal((await execute(applicable())).errors?.[0].extensions.code,"NOT_FOUND");
  await seed();
  assert.equal((await execute(applicable('downloadableFileId:"file",scope:"CHANNEL",discussionId:"other",channelUniqueName:"cats"'))).errors?.[0].extensions.code,"NOT_FOUND");
  await driver.executeQuery("MATCH(f:DownloadableFile) SET f.permanentlyRemoved=true");
  assert.equal((await execute(applicable())).errors?.[0].extensions.code,"NOT_FOUND");
  await driver.executeQuery("MATCH(f:DownloadableFile) SET f.permanentlyRemoved=false WITH f MATCH(p:DiscussionChannel) SET p.archived=true");
  assert.equal((await execute(applicable())).errors?.[0].extensions.code,"NOT_FOUND");
});
test("malformed generated visibility values fail before policy response", async () => {
  await seed();await driver.executeQuery("MATCH(f:DownloadableFile) SET f.permanentlyRemoved='bad'");
  assert.match((await execute(applicable())).errors?.[0].message ?? "",/Boolean cannot represent/);
});
test("server JSON mutation preserves explicit null optional fields and persisted output", async () => {
  await seed();
  const pipelines=[{event:"comment.created",steps:[{pluginId:"scanner",version:null,continueOnError:null,condition:null}],stopOnFirstFailure:null,effectiveAt:null,applicability:null,policyId:null}];
  assert.deepEqual(data(await execute(serverMutation,{pipelines})).result,pipelines);
  const persisted=await driver.executeQuery("MATCH(s:ServerConfig) RETURN s.pluginPipelines AS value");
  assert.deepEqual(JSON.parse(persisted.records[0].get("value")),pipelines);
  assert.deepEqual(data(await execute(serverMutation,{pipelines:[]})).result,[]);
});
test("download policy defaults returned as JSON are the persisted policy", async () => {
  await seed(); const pipelines=[{event:"downloadableFile.created",steps:[{pluginId:"scanner"}]}];
  const result=data(await execute(serverMutation,{pipelines})).result;
  assert.equal(result[0].applicability,"NEW_FILES_ONLY");assert.ok(result[0].policyId);assert.ok(result[0].effectiveAt);
  const persisted=await driver.executeQuery("MATCH(s:ServerConfig) RETURN s.pluginPipelines AS value");
  assert.deepEqual(JSON.parse(persisted.records[0].get("value")),result);
});
test("pipeline input coercion and resolver validation reject before persistence", async () => {
  assert.match((await execute(serverMutation,{pipelines:[{event:"comment.created",steps:[{}]}]})).errors?.[0].message ?? "",/pluginId/);
  assert.match((await execute(serverMutation,{pipelines:[{event:"",steps:[]}]})).errors?.[0].message ?? "",/each pipeline must have an event/);
  assert.match((await execute(serverMutation,{pipelines:[]})).errors?.[0].message ?? "",/No server config found/);
  assert.match((await execute(channelMutation,{pipelines:[]})).errors?.[0].message ?? "",/not found/);
});
test("server unused generated update selection failure still occurs after commit", async () => {
  await seed();await driver.executeQuery("MATCH(s:ServerConfig) SET s.enableDownloads='bad'");
  const result=await execute(serverMutation,{pipelines:[]});assert.match(result.errors?.[0].message ?? "",/Boolean cannot represent/);
  const persisted=await driver.executeQuery("MATCH(s:ServerConfig) RETURN s.pluginPipelines AS value");assert.equal(persisted.records[0].get("value"),'[]');
});
test("channel JSON mutation accepts empty membership and preserves explicit nullable steps", async () => {
  await seed();await driver.executeQuery("MATCH(c:Channel) SET c.createdAt=datetime()");
  const pipelines=[{event:"comment.created",steps:[{pluginId:"scanner",version:null,condition:null,continueOnError:null}]}];
  assert.deepEqual(data(await execute(channelMutation,{pipelines})).result,pipelines);
  assert.deepEqual(data(await execute(channelMutation,{pipelines:[]})).result,[]);
  const persisted=await driver.executeQuery("MATCH(c:Channel) RETURN c.pluginPipelines AS value");assert.equal(persisted.records[0].get("value"),'[]');
});
test("channel policy authentication middleware prevents anonymous writes", async () => {
  await seed();const result=await execute(channelMutation,{pipelines:[]},true);assert.ok(result.errors?.length);
  const persisted=await driver.executeQuery("MATCH(c:Channel) RETURN c.pluginPipelines AS value");assert.notEqual(persisted.records[0].get("value"),'[]');
});

test("post-save bot configuration failure is swallowed while returning persisted channel JSON", async () => {
  await seed();
  await driver.executeQuery("MATCH(c:Channel) SET c.createdAt=datetime() WITH c MATCH(:ServerConfig)-[r:INSTALLED]->() SET r.enabled='invalid'");
  const pipelines=[{event:"comment.created",steps:[{pluginId:"scanner"}]}];
  assert.deepEqual(data(await execute(channelMutation,{pipelines})).result,pipelines);
  const persisted=await driver.executeQuery("MATCH(c:Channel) RETURN c.pluginPipelines AS value");
  assert.deepEqual(JSON.parse(persisted.records[0].get("value")),pipelines);
});
