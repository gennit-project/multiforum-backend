import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { graphql, type GraphQLSchema } from "graphql";
import { applyMiddleware } from "graphql-middleware";
import typeDefs from "../../typeDefs.js";
import permissions from "../../permissions.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import {
  startImageModEnv, stopImageModEnv, resetDb, run, mockToken, modContext,
  type ImageModEnv,
} from "./imageModerationHarness.js";

// Real query resolvers, schema and Shield permissions against disposable Neo4j.
// Mock tokens replace only the external authentication provider; user identity,
// server roles and graph relationships are loaded from the fixture database.
let env: ImageModEnv;
let schema: GraphQLSchema;
const previousServerName = process.env.SERVER_CONFIG_NAME;
before(async () => {
  process.env.SERVER_CONFIG_NAME = "download-query-fixture";
  env = await startImageModEnv();
  const generated = await new Neo4jGraphQL({
    driver: env.driver, typeDefs, resolvers: env.resolvers,
    features: { filters: { String: { MATCHES: true } } },
  }).getSchema();
  registerGeneratedSchema(env.driver, generated);
  schema = applyMiddleware(generated, permissions);
}, { timeout: 240000 });
after(async () => {
  await stopImageModEnv();
  if (previousServerName === undefined) delete process.env.SERVER_CONFIG_NAME;
  else process.env.SERVER_CONFIG_NAME = previousServerName;
});
beforeEach(async () => {
  await resetDb();
  await run(`
    CREATE (alice:User {username:'alice'})
    CREATE (:User {username:'bob'})
    CREATE (mod:User {username:'moderator'})-[:MODERATION_PROFILE]->(profile:ModerationProfile {displayName:'Reviewer'})
    CREATE (:User {username:'unprivileged-mod'})-[:MODERATION_PROFILE]->(:ModerationProfile {displayName:'Unprivileged'})
    CREATE (config:ServerConfig {serverName:'download-query-fixture'})
    CREATE (config)-[:HAS_DEFAULT_MOD_ROLE]->(:ModServerRole {name:'default', canPermanentlyRemoveImage:false})
    CREATE (config)-[:HAS_DEFAULT_ELEVATED_MOD_ROLE]->(:ModServerRole {name:'reviewer', canPermanentlyRemoveImage:true})
    CREATE (profile)-[:MODERATOR_OF_SERVER]->(config)
    CREATE (alice)-[:POSTED_DISCUSSION]->(discussion:Discussion {
      id:'discussion', title:'Upload', createdAt:datetime('2026-01-01T00:00:00Z'), hasSensitiveContent:false
    })
    CREATE (discussion)-[:HAS_DOWNLOADABLE_FILE]->(:DownloadableFile {
      id:'file', fileName:'file.zip', kind:'ZIP', createdAt:datetime('2026-01-02T00:00:00Z'),
      uploadedByUsername:'alice', scanStatus:'SUSPICIOUS', scanReason:'fixture scan'
    })
    CREATE (dc:DiscussionChannel {id:'post', channelUniqueName:'forum'})-[:POSTED_IN_CHANNEL]->(discussion)
    CREATE (dc)-[:POSTED_IN_CHANNEL]->(:Channel {uniqueName:'forum'})
  `);
});
const inventory = `{ getUploadedDownloadableFiles(username:"alice") {
  discussion { id title channelUniqueNames } files { id fileName }
} }`;
const queue = `{ getDownloadScanReviewQueue {
  downloadableFileId uploaderUsername channelUniqueName discussionId scanStatus scanReason
} }`;
const execute = (source: string, username: string | null = "alice", sensitive = false) => graphql({
  schema, source,
  contextValue: {
    ...(username
      ? modContext(env, mockToken({ username, email: `${username}@example.invalid` }))
      : { driver: env.driver, req: { headers: {}, body: {} } }),
    // Same resolved age-access decision consumed by both production queries.
    mayAccessSensitiveContent: sensitive,
  },
});
function data(result: Awaited<ReturnType<typeof execute>>) {
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  return JSON.parse(JSON.stringify(result.data));
}
function denied(result: Awaited<ReturnType<typeof execute>>) {
  assert.ok(result.errors?.length, "request must be denied");
  assert.match(result.errors[0].message, /logged in|Not authorized|Not Authorised|permission|moderator/);
  assert.equal(result.data, null, "denial must not return private inventory or queue rows");
}

test("inventory follows canonical channel edges, deduplicates names and preserves file/group order", async () => {
  await run(`
    MATCH (d:Discussion {id:'discussion'}), (alice:User {username:'alice'})
    CREATE (:DiscussionChannel {id:'duplicate', channelUniqueName:'forum'})-[:POSTED_IN_CHANNEL]->(d)
    CREATE (second:DiscussionChannel {id:'second', channelUniqueName:'second-forum'})-[:POSTED_IN_CHANNEL]->(d)
    CREATE (second)-[:POSTED_IN_CHANNEL]->(:Channel {uniqueName:'second-forum'})
    CREATE (d)-[:POSTED_IN_CHANNEL]->(:DiscussionChannel {id:'wrong-direction', channelUniqueName:'decoy'})
    CREATE (d)-[:HAS_DOWNLOADABLE_FILE]->(:DownloadableFile {
      id:'new-file', fileName:'new.zip', kind:'ZIP', uploadedByUsername:'alice', createdAt:datetime('2026-01-03T00:00:00Z')
    })
    CREATE (alice)-[:POSTED_DISCUSSION]->(older:Discussion {id:'older', title:'Older', createdAt:datetime('2025-01-01T00:00:00Z')})
    CREATE (older)-[:HAS_DOWNLOADABLE_FILE]->(:DownloadableFile {
      id:'older-file', fileName:'older.zip', kind:'ZIP', uploadedByUsername:'alice', createdAt:datetime('2025-01-01T00:00:00Z')
    })
  `);
  const groups = data(await execute(inventory)).getUploadedDownloadableFiles;
  assert.deepEqual(groups.map((g: { discussion: { id: string } }) => g.discussion.id), ["discussion", "older"]);
  assert.deepEqual([...groups[0].discussion.channelUniqueNames].sort(), ["forum", "second-forum"]);
  assert.deepEqual(groups[0].files.map((f: { id: string }) => f.id), ["new-file", "file"]);
  assert.deepEqual(groups[1].discussion.channelUniqueNames, []);
});

test("inventory excludes removed files and other uploaders even on the caller's discussion", async () => {
  await run(`MATCH (d:Discussion {id:'discussion'})
    CREATE (d)-[:HAS_DOWNLOADABLE_FILE]->(:DownloadableFile {id:'removed', uploadedByUsername:'alice', permanentlyRemoved:true})
    CREATE (d)-[:HAS_DOWNLOADABLE_FILE]->(:DownloadableFile {id:'other-uploader', uploadedByUsername:'bob'})
    CREATE (d)-[:HAS_DOWNLOADABLE_FILE]->(:DownloadableFile {id:'missing-uploader'})`);
  assert.deepEqual(data(await execute(inventory)).getUploadedDownloadableFiles[0].files, [{ id:"file", fileName:"file.zip" }]);
});

test("files without an owning discussion are absent from both query results", async () => {
  await run("MATCH (:Discussion)-[edge:HAS_DOWNLOADABLE_FILE]->(:DownloadableFile {id:'file'}) DELETE edge");
  assert.deepEqual(data(await execute(inventory)).getUploadedDownloadableFiles, []);
  assert.deepEqual(data(await execute(queue, "moderator")).getDownloadScanReviewQueue, []);
});

test("review queue falls back to canonical discussion author only when stored uploader is absent", async () => {
  await run(`MATCH (f:DownloadableFile {id:'file'}) REMOVE f.uploadedByUsername`);
  assert.deepEqual(data(await execute(queue, "moderator")).getDownloadScanReviewQueue, [{
    downloadableFileId:"file", uploaderUsername:"alice", channelUniqueName:"forum",
    discussionId:"discussion", scanStatus:"SUSPICIOUS", scanReason:"fixture scan",
  }]);
  await run("MATCH (f:DownloadableFile {id:'file'}) SET f.uploadedByUsername = 'stored-uploader'");
  assert.equal(data(await execute(queue, "moderator")).getDownloadScanReviewQueue[0].uploaderUsername, "stored-uploader");
});

test("missing canonical author and channel return null without using decoy relationships", async () => {
  await run(`MATCH (:User)-[author:POSTED_DISCUSSION]->(d:Discussion {id:'discussion'}) DELETE author
    WITH d MATCH (:DiscussionChannel)-[channel:POSTED_IN_CHANNEL]->(d) DELETE channel
    WITH d MATCH (f:DownloadableFile {id:'file'}) REMOVE f.uploadedByUsername
    CREATE (:User {username:'decoy'})-[:AUTHORED_DISCUSSION]->(d)
    CREATE (d)-[:POSTED_IN_CHANNEL]->(:DiscussionChannel {channelUniqueName:'decoy-forum'})`);
  const rows = data(await execute(queue, "moderator")).getDownloadScanReviewQueue;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].uploaderUsername, null);
  assert.equal(rows[0].channelUniqueName, null);
});

test("review queue preserves status/removal filters, request priority and limit across multiple channels", async () => {
  await run(`MATCH (d:Discussion {id:'discussion'})
    CREATE (:DiscussionChannel {id:'second-post', channelUniqueName:'second'})-[:POSTED_IN_CHANNEL]->(d)
    CREATE (d)-[:HAS_DOWNLOADABLE_FILE]->(:DownloadableFile {
      id:'requested', fileName:'request.zip', scanStatus:'FAILED', reviewRequestedAt:datetime('2026-01-03T00:00:00Z')
    })
    CREATE (d)-[:HAS_DOWNLOADABLE_FILE]->(:DownloadableFile {id:'infected', fileName:'infected.zip', scanStatus:'INFECTED'})
    CREATE (d)-[:HAS_DOWNLOADABLE_FILE]->(:DownloadableFile {id:'clean', scanStatus:'CLEAN'})
    CREATE (d)-[:HAS_DOWNLOADABLE_FILE]->(:DownloadableFile {id:'pending', scanStatus:'PENDING'})
    CREATE (d)-[:HAS_DOWNLOADABLE_FILE]->(:DownloadableFile {id:'removed', scanStatus:'INFECTED', permanentlyRemoved:true})`);
  const rows = data(await execute(queue, "moderator")).getDownloadScanReviewQueue;
  assert.deepEqual(rows.map((r: { downloadableFileId: string }) => r.downloadableFileId), ["requested", "infected", "file"]);
  // The existing API chooses one channel; no ordering guarantee is added here.
  assert.ok(rows.every((r: { channelUniqueName: string }) => ["forum", "second"].includes(r.channelUniqueName)));
  const limited = data(await execute(queue.replace("getDownloadScanReviewQueue", "getDownloadScanReviewQueue(limit:1)"), "moderator")).getDownloadScanReviewQueue;
  assert.deepEqual(limited.map((r: { downloadableFileId: string }) => r.downloadableFileId), ["requested"]);
});

test("sensitive discussion contents stay hidden unless the resolved age-access decision allows them", async () => {
  await run("MATCH (d:Discussion {id:'discussion'}) SET d.hasSensitiveContent = true");
  assert.deepEqual(data(await execute(inventory)).getUploadedDownloadableFiles, []);
  assert.deepEqual(data(await execute(queue, "moderator")).getDownloadScanReviewQueue, []);
  assert.equal(data(await execute(inventory, "alice", true)).getUploadedDownloadableFiles.length, 1);
  assert.equal(data(await execute(queue, "moderator", true)).getDownloadScanReviewQueue.length, 1);
});

test("inventory denies anonymous users, other users and moderators requesting another user's files", async () => {
  for (const user of [null, "bob", "moderator"]) denied(await execute(inventory, user));
});

test("review queue denies anonymous users, upload owners and moderators without the server capability", async () => {
  for (const user of [null, "alice", "bob", "unprivileged-mod"]) denied(await execute(queue, user));
  assert.equal(data(await execute(queue, "moderator")).getDownloadScanReviewQueue.length, 1);
});
