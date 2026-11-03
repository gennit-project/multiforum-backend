import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { graphql, type GraphQLSchema } from "graphql";
import { applyMiddleware } from "graphql-middleware";
import typeDefs from "../../typeDefs.js";
import permissions from "../../permissions.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { pluginModuleCache } from "../../services/plugin/pluginLoader.js";
import { createContentRevisionHash } from "../../services/plugin/moderationJobIdentity.js";
import { startImageModEnv, stopImageModEnv, resetDb, run, modContext, mockToken, type ImageModEnv } from "./imageModerationHarness.js";

const EVENT = "discussionChannel.created";
const PLUGIN = "discussion-target-fixture";
const URL = "https://fixture.invalid/discussion-target.tgz";
const VERSION = "2020-01-01T00:00:00.000Z";
let calls: Array<{ type: string; payload: { discussionId: string } }> = [];
let failProvider = false;
class FixturePlugin {
  async handleEvent(event: unknown) {
    calls.push(structuredClone(event) as typeof calls[number]);
    if (failProvider) throw new Error("deterministic provider failure");
    return { success: true, result: { message: "fixture completed" } };
  }
}
let env: ImageModEnv;
let schema: GraphQLSchema;
const previousServer = process.env.SERVER_CONFIG_NAME;
before(async () => {
  process.env.SERVER_CONFIG_NAME = "discussion-target-fixture";
  env = await startImageModEnv();
  const raw = await new Neo4jGraphQL({ driver: env.driver, typeDefs, resolvers: env.resolvers,
    features: { filters: { String: { MATCHES: true } } },
  }).getSchema();
  registerGeneratedSchema(env.driver, raw);
  schema = applyMiddleware(raw, permissions);
  pluginModuleCache.set(`${URL}:index.js`, FixturePlugin);
}, { timeout: 240000 });
after(async () => {
  pluginModuleCache.delete(`${URL}:index.js`);
  await stopImageModEnv();
  if (previousServer === undefined) delete process.env.SERVER_CONFIG_NAME;
  else process.env.SERVER_CONFIG_NAME = previousServer;
});
beforeEach(async () => {
  calls = []; failProvider = false;
  await resetDb();
  await run(`
    CREATE (owner:User {username:'owner'}) CREATE (:User {username:'outsider'}) CREATE (:User {username:'uploader'})
    CREATE (moderator:User {username:'moderator'})-[:MODERATION_PROFILE]->(profile:ModerationProfile {displayName:'Reviewer'})
    CREATE (s:ServerConfig {serverName:'discussion-target-fixture', pluginPipelines:$pipelines})
    CREATE (s)-[:HAS_DEFAULT_MOD_ROLE]->(:ModServerRole {name:'default', canEditDiscussions:false})
    CREATE (ch:Channel {uniqueName:'forum', displayName:'Forum', pluginPipelines:$pipelines})
    CREATE (ch)-[:HAS_DEFAULT_ELEVATED_MOD_ROLE]->(:ModChannelRole {name:'reviewer', canEditDiscussions:true})
    CREATE (profile)-[:MODERATOR_OF_CHANNEL]->(ch)
    CREATE (p:Plugin {id:'plugin', name:$plugin})-[:HAS_VERSION]->(v:PluginVersion {
      id:'version', version:'1', repoUrl:$url, entryPath:'index.js', manifest:$manifest
    })
    CREATE (s)-[:INSTALLED {enabled:true}]->(v) CREATE (ch)-[:ENABLED {enabled:true}]->(v)
    CREATE (owner)-[:POSTED_DISCUSSION]->(d:Discussion {
      id:'discussion', title:'Title', body:'Body', createdAt:datetime($version)
    })
    CREATE (dc:DiscussionChannel {id:'post', discussionId:'discussion', channelUniqueName:'forum', archived:false})
    CREATE (dc)-[:POSTED_IN_CHANNEL]->(d) CREATE (dc)-[:POSTED_IN_CHANNEL]->(ch)
  `, { plugin: PLUGIN, url: URL, version: VERSION,
    manifest: JSON.stringify({ events: [EVENT] }),
    pipelines: JSON.stringify([{ event: EVENT, steps: [{ pluginId: PLUGIN, version: "1" }] }]),
  });
});
async function attach() {
  await run(`MATCH (d:Discussion {id:'discussion'}) CREATE (d)-[:HAS_DOWNLOADABLE_FILE]->(:DownloadableFile {
    id:'file', fileName:'file.zip', kind:'ZIP', url:'https://example.invalid/file.zip',
    createdAt:datetime($version), uploadedAt:datetime($version), uploadedByUsername:'uploader', scanStatus:'CLEAN'
  })`, { version: VERSION });
}
const fields = "pipelineId targetId targetType targetVersion scope channelId status trigger retryOfPipelineRunId initiatedByUsername attemptNumber";
const start = `mutation { startPluginPipeline(targetId:"discussion",targetType:"Discussion",channelId:"forum",eventType:"${EVENT}") { ${fields} } }`;
const retry = (pipelineId: string) => `mutation { rerunPluginPipeline(pipelineRunId:"${pipelineId}") { ${fields} } }`;
const execute = (source: string, username: string | null = "owner") => graphql({ schema, source,
  contextValue: username ? modContext(env, mockToken({ username, email: `${username}@example.invalid` })) : { driver:env.driver, req:{headers:{},body:{}} },
});
function ok(result: Awaited<ReturnType<typeof execute>>, field = "startPluginPipeline") {
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  return JSON.parse(JSON.stringify(result.data))[field] as { pipelineId:string; status:string; targetVersion:string; trigger:string; retryOfPipelineRunId:string|null; attemptNumber:number; initiatedByUsername:string };
}
function rejected(result: Awaited<ReturnType<typeof execute>>, message: RegExp) {
  assert.match(result.errors?.[0].message ?? "", message);
  assert.equal(result.data, null);
}
async function failedAttempt() {
  failProvider = true;
  const attempt = ok(await execute(start));
  assert.equal(attempt.status, "FAILED");
  failProvider = false;
  return attempt;
}
async function assertJobs(statuses: string[]) {
  const rows = await run("MATCH (r:PluginRun) RETURN r.status AS status ORDER BY r.createdAt");
  assert.deepEqual(rows.map(r => r.status), statuses);
}

for (const attachment of [false, true]) {
  test(`real start and rerun execute and persist status/lineage with attachment=${attachment}`, async () => {
    if (attachment) await attach();
    const source = await failedAttempt();
    assert.equal(source.targetVersion, createContentRevisionHash({ channelUniqueName:"forum",contentId:"discussion",contentType:"Discussion",title:"Title",body:"Body",attachmentVersion:attachment ? VERSION : null }));
    await assertJobs(["FAILED"]);
    const rerun = ok(await execute(retry(source.pipelineId)), "rerunPluginPipeline");
    assert.equal(rerun.status, "SUCCEEDED");
    assert.equal(rerun.targetVersion, source.targetVersion);
    assert.equal(rerun.trigger, "OWNER_RETRY");
    assert.equal(rerun.retryOfPipelineRunId, source.pipelineId);
    assert.equal(rerun.initiatedByUsername, "owner");
    assert.equal(rerun.attemptNumber, 2);
    assert.deepEqual(calls.map(c => [c.type,c.payload.discussionId]), [[EVENT,"discussion"],[EVENT,"discussion"]]);
    await assertJobs(["FAILED","SUCCEEDED"]);
  });
}

test("attachment uploader and authorized moderator retain permission to start", async () => {
  await attach();
  assert.equal(ok(await execute(start,"uploader")).trigger,"OWNER_START");
  failProvider = true;
  const source = ok(await execute(start,"moderator"));
  assert.equal(source.trigger,"MODERATOR_START");
  assert.equal(source.status,"FAILED");
  failProvider = false;
  const rerun = ok(await execute(retry(source.pipelineId),"moderator"),"rerunPluginPipeline");
  assert.equal(rerun.trigger,"MODERATOR_RETRY");
  assert.equal(rerun.retryOfPipelineRunId,source.pipelineId);
  await assertJobs(["SUCCEEDED","FAILED","SUCCEEDED"]);
});

test("anonymous and unrelated users cannot start or rerun", async () => {
  for (const user of [null,"outsider"]) rejected(await execute(start,user), /logged in|authorized/);
  assert.equal(calls.length,0);
  await assertJobs([]);
  const source = await failedAttempt();
  for (const user of [null,"outsider"]) rejected(await execute(retry(source.pipelineId),user), /logged in|authorized/);
  assert.equal(calls.length,1);
  await assertJobs(["FAILED"]);
});

test("missing targets, missing attempt and archived/wrong forum cannot execute", async () => {
  rejected(await execute(start.replace('targetId:"discussion"','targetId:"missing"')),/not found/);
  rejected(await execute(start.replace('channelId:"forum"','channelId:"other"')),/not found/);
  rejected(await execute(retry("missing")),/not found/);
  await run("MATCH (dc:DiscussionChannel) SET dc.archived = true");
  rejected(await execute(start),/not found/);
  assert.equal(calls.length,0);
  await assertJobs([]);
});

for (const change of ["body", "attachment"] as const) {
  test(`rerun rejects changed ${change} without executing another job`, async () => {
    await attach();
    const source = await failedAttempt();
    if (change === "body") await run("MATCH (d:Discussion) SET d.body = 'Changed'");
    else await run("MATCH (f:DownloadableFile) SET f.uploadedAt = datetime('2021-01-01T00:00:00Z')");
    rejected(await execute(retry(source.pipelineId)),/has changed/);
    assert.equal(calls.length,1);
    await assertJobs(["FAILED"]);
  });
}

for (const legacy of [false, true]) test(`active current-revision attempt blocks another start legacy=${legacy}`, async () => {
  await attach();
  const source = await failedAttempt();
  await run("MATCH (p:PluginPipelineRun {pipelineId:$id}) SET p.status = 'RUNNING'",{id:source.pipelineId});
  if (legacy) await run("MATCH (p:PluginPipelineRun {pipelineId:$id}) SET p.targetVersion = $version",{id:source.pipelineId,version:VERSION});
  rejected(await execute(start),/active attempt/);
  assert.equal(calls.length,1);
});

for (const changed of [false, true]) test(`legacy timestamp-version attachment guard changed=${changed}`, async () => {
  await attach();
  const source = await failedAttempt();
  await run("MATCH (p:PluginPipelineRun {pipelineId:$id}) SET p.targetVersion = $version",{id:source.pipelineId,version:VERSION});
  if (changed) {
    await run("MATCH (f:DownloadableFile) SET f.uploadedAt = datetime('2021-01-01T00:00:00Z')");
    rejected(await execute(retry(source.pipelineId)),/has changed/);
    assert.equal(calls.length,1);
  } else {
    assert.equal(ok(await execute(retry(source.pipelineId)),"rerunPluginPipeline").status,"SUCCEEDED");
    rejected(await execute(retry(source.pipelineId)),/Only the latest/);
    assert.equal(calls.length,2);
  }
});
