import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import {
  mockToken,
  modContext,
  resetDb,
  run,
  startImageModEnv,
  stopImageModEnv,
  type ImageModEnv,
} from "./imageModerationHarness.js";

let env: ImageModEnv;

before(async () => {
  env = await startImageModEnv();
}, { timeout: 240000 });

after(async () => {
  await stopImageModEnv();
});

beforeEach(async () => {
  await resetDb();
  await run(`
    CREATE (user:User {username: "alice"})
    CREATE (discussion:Discussion {
      id: "discussion-1",
      title: "Download",
      hasSensitiveContent: false
    })
    CREATE (file:DownloadableFile {
      id: "file-1",
      fileName: "safe.zip",
      scanStatus: "CLEAN",
      downloadCountTotal: 0,
      downloadCountUnique: 0
    })
    CREATE (user)-[:POSTED_DISCUSSION]->(discussion)
    CREATE (discussion)-[:HAS_DOWNLOADABLE_FILE]->(file)
  `);
});

test("authenticated download tracking persists counters and the saved collection", async () => {
  const context = modContext(
    env,
    mockToken({ username: "alice", email: "alice@example.com" })
  );

  await env.resolvers.Mutation.trackDownload(
    null,
    { downloadableFileId: "file-1", discussionId: "discussion-1" },
    context
  );
  await env.resolvers.Mutation.trackDownload(
    null,
    { downloadableFileId: "file-1", discussionId: "discussion-1" },
    context
  );

  const rows = await run(`
    MATCH (user:User {username: "alice"})-[download:DOWNLOADED_FILE]->(file:DownloadableFile {id: "file-1"})
    MATCH (user)<-[:CREATED_BY]-(collection:Collection {name: "Downloaded Items"})
    MATCH (collection)-[:CONTAINS_DOWNLOAD]->(discussion:Discussion {id: "discussion-1"})
    MATCH (user)-[:OWNS_DOWNLOAD]->(discussion)
    RETURN
      file.downloadCountTotal AS total,
      file.downloadCountUnique AS unique,
      collection.itemOrder AS itemOrder,
      count(download) AS downloadRelationships
  `);

  const row = rows[0] as {
    total: { toNumber: () => number };
    unique: { toNumber: () => number };
    itemOrder: string[];
    downloadRelationships: { toNumber: () => number };
  };
  assert.deepEqual({
    total: row.total.toNumber(),
    unique: row.unique.toNumber(),
    itemOrder: row.itemOrder,
    downloadRelationships: row.downloadRelationships.toNumber(),
  }, {
    total: 2,
    unique: 1,
    itemOrder: ["discussion-1"],
    downloadRelationships: 1,
  });
});
