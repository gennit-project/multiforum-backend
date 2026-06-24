// Integration tests for list/feed query resolvers against live Neo4j:
// getSiteWideWikiList, getSortedChannels. Both run Cypher and return a list plus
// an aggregate count. No auth context needed.

import test, { before, after, beforeEach } from "node:test";
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

// --- getSiteWideWikiList ---

test("getSiteWideWikiList returns all wiki pages with a total count", async () => {
  await run(
    `CREATE (:WikiPage { id: 'w1', title: 'Alpha Guide', slug: 'alpha', body: 'aaa', channelUniqueName: 'cats', createdAt: datetime() })
     CREATE (:WikiPage { id: 'w2', title: 'Beta Guide', slug: 'beta', body: 'bbb', channelUniqueName: 'dogs', createdAt: datetime() })`
  );

  const result = await env.resolvers.Query.getSiteWideWikiList(null, {});

  assert.equal(result.wikiPages.length, 2);
  assert.equal(Number(result.aggregateWikiPageCount), 2);
});

test("getSiteWideWikiList filters by search input", async () => {
  await run(
    `CREATE (:WikiPage { id: 'w1', title: 'Alpha Guide', slug: 'alpha', body: 'aaa', channelUniqueName: 'cats', createdAt: datetime() })
     CREATE (:WikiPage { id: 'w2', title: 'Beta Guide', slug: 'beta', body: 'bbb', channelUniqueName: 'dogs', createdAt: datetime() })`
  );

  const result = await env.resolvers.Query.getSiteWideWikiList(null, {
    searchInput: "Alpha",
  });

  assert.equal(result.wikiPages.length, 1);
  assert.equal(result.wikiPages[0].title, "Alpha Guide");
});

// --- getSortedChannels ---

test("getSortedChannels returns channels with an aggregate count", async () => {
  await run(
    `CREATE (:Channel { uniqueName: 'cats', description: 'cat stuff', createdAt: datetime() })
     CREATE (:Channel { uniqueName: 'dogs', description: 'dog stuff', createdAt: datetime() })`
  );

  const result = await env.resolvers.Query.getSortedChannels(null, { countDownloads: null });

  assert.equal(result.channels.length, 2);
  assert.equal(Number(result.aggregateChannelCount), 2);
});

test("getSortedChannels filters by search input", async () => {
  await run(
    `CREATE (:Channel { uniqueName: 'cats', description: 'cat stuff', createdAt: datetime() })
     CREATE (:Channel { uniqueName: 'dogs', description: 'dog stuff', createdAt: datetime() })`
  );

  const result = await env.resolvers.Query.getSortedChannels(null, {
    searchInput: "cat",
    countDownloads: null,
  });

  assert.equal(result.channels.length, 1);
  assert.equal(result.channels[0].uniqueName, "cats");
});
