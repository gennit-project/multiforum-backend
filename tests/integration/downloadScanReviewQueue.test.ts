import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  startImageModEnv,
  stopImageModEnv,
  resetDb,
  run,
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
});

test("download scan review queue includes held files and prioritizes requests", async () => {
  await run(`
    CREATE (channel:Channel {uniqueName: 'general', displayName: 'General'})
    CREATE (author:User {username: 'alice'})
    CREATE (discussion:Discussion {
      id: 'discussion-1',
      title: 'Download',
      createdAt: datetime(),
      hasDownload: true
    })
    CREATE (dc:DiscussionChannel {
      id: 'dc-1',
      discussionId: 'discussion-1',
      channelUniqueName: 'general',
      createdAt: datetime()
    })
    CREATE (requested:DownloadableFile {
      id: 'requested-file',
      fileName: 'requested.zip',
      kind: 'OTHER',
      url: 'https://example.com/requested.zip',
      createdAt: datetime(),
      scanStatus: 'SUSPICIOUS',
      reviewRequestedAt: datetime(),
      reviewRequestReason: 'False positive'
    })
    CREATE (unrequested:DownloadableFile {
      id: 'unrequested-file',
      fileName: 'unrequested.zip',
      kind: 'OTHER',
      url: 'https://example.com/unrequested.zip',
      createdAt: datetime(),
      scanStatus: 'INFECTED'
    })
    CREATE (clean:DownloadableFile {
      id: 'clean-file',
      fileName: 'clean.zip',
      kind: 'OTHER',
      url: 'https://example.com/clean.zip',
      createdAt: datetime(),
      scanStatus: 'CLEAN'
    })
    CREATE (author)-[:POSTED_DISCUSSION]->(discussion)
    CREATE (dc)-[:POSTED_IN_CHANNEL]->(discussion)
    CREATE (dc)-[:POSTED_IN_CHANNEL]->(channel)
    CREATE (discussion)-[:HAS_DOWNLOADABLE_FILE]->(requested)
    CREATE (discussion)-[:HAS_DOWNLOADABLE_FILE]->(unrequested)
    CREATE (discussion)-[:HAS_DOWNLOADABLE_FILE]->(clean)
  `);

  const result = await env.resolvers.Query.getDownloadScanReviewQueue(
    null,
    { limit: 10 }
  );

  assert.deepEqual(
    result.map((item: any) => ({
      id: item.downloadableFileId,
      requested: Boolean(item.reviewRequestedAt),
      channel: item.channelUniqueName,
    })),
    [
      { id: "requested-file", requested: true, channel: "general" },
      { id: "unrequested-file", requested: false, channel: "general" },
    ]
  );
});
