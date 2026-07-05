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

// --- getSiteWideDiscussionList ---

test("getSiteWideDiscussionList includes channel icon URLs for discussion channels", async () => {
  await run(
    `CREATE (channel:Channel {
        uniqueName: 'cats',
        displayName: 'Cats',
        channelIconURL: 'https://example.com/cats-icon.png'
      })
      CREATE (author:User {
        username: 'alice',
        createdAt: datetime(),
        discussionKarma: 1,
        commentKarma: 2
      })
      CREATE (discussion:Discussion {
        id: 'd1',
        title: 'Alpha discussion',
        body: 'hello',
        createdAt: datetime(),
        hasDownload: false
      })
      CREATE (dc:DiscussionChannel {
        id: 'dc1',
        discussionId: 'd1',
        channelUniqueName: 'cats',
        createdAt: datetime(),
        weightedVotesCount: 1
      })
      CREATE (author)-[:POSTED_DISCUSSION]->(discussion)
      CREATE (dc)-[:POSTED_IN_CHANNEL]->(discussion)`
  );

  const result = await env.resolvers.Query.getSiteWideDiscussionList(null, {
    searchInput: "",
    selectedChannels: [],
    selectedTags: [],
    showArchived: false,
    hasDownload: false,
    options: {
      offset: "0",
      limit: "10",
      resultsOrder: "desc",
      sort: "new",
      timeFrame: "week",
    },
  });

  assert.equal(result.discussions.length, 1);
  assert.equal(result.discussions[0].DiscussionChannels.length, 1);
  assert.equal(result.discussions[0].DiscussionChannels[0].Channel.uniqueName, "cats");
  assert.equal(
    result.discussions[0].DiscussionChannels[0].Channel.channelIconURL,
    "https://example.com/cats-icon.png"
  );
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

// --- publicCollectionsContaining ---

const seedImageInCollections = () =>
  run(
    `CREATE (owner:User { username: 'owner' })
     CREATE (img:Image { id: 'img-1', scanStatus: 'PENDING' })
     CREATE (pub:Collection { id: 'coll-pub', name: 'Public Set', visibility: 'PUBLIC', collectionType: 'IMAGES', itemOrder: [], createdAt: datetime(), updatedAt: datetime() })
     CREATE (priv:Collection { id: 'coll-priv', name: 'Private Set', visibility: 'PRIVATE', collectionType: 'IMAGES', itemOrder: [], createdAt: datetime(), updatedAt: datetime() })
     CREATE (pub)-[:CREATED_BY]->(owner)
     CREATE (priv)-[:CREATED_BY]->(owner)
     CREATE (pub)-[:CONTAINS_IMAGE]->(img)
     CREATE (priv)-[:CONTAINS_IMAGE]->(img)`
  );

test("publicCollectionsContaining returns only PUBLIC collections with the image", async () => {
  await seedImageInCollections();

  const result = await env.resolvers.Query.publicCollectionsContaining(null, {
    itemType: "IMAGE",
    itemId: "img-1",
  });

  assert.equal(result.length, 1, "only the public collection should be returned");
  assert.equal(result[0].id, "coll-pub");
  assert.equal(result[0].visibility, "PUBLIC");
});

test("publicCollectionsContaining throws on an unsupported itemType", async () => {
  await assert.rejects(
    env.resolvers.Query.publicCollectionsContaining(null, {
      itemType: "BOGUS",
      itemId: "x",
    }),
    /Unsupported itemType/i
  );
});

// --- getInstalledPlugins (registry fetch is best-effort; seed no registry to skip it) ---

test("getInstalledPlugins lists installed plugin versions with their enabled state", async () => {
  await run(
    `CREATE (p:Plugin { id: 'p1', name: 'test-plugin', displayName: 'Test Plugin' })
     CREATE (pv:PluginVersion { id: 'pv1', version: '1.0.0', entryPath: 'index.js', repoUrl: 'https://example.com/repo' })
     CREATE (p)-[:HAS_VERSION]->(pv)
     CREATE (sc:ServerConfig { serverName: 'test-server' })
     CREATE (sc)-[:INSTALLED { enabled: true }]->(pv)`
  );

  const result = await env.resolvers.Query.getInstalledPlugins(null, {}, {});

  assert.equal(result.length, 1);
  assert.equal(result[0].plugin.name, "test-plugin");
  assert.equal(result[0].version, "1.0.0");
  assert.equal(result[0].enabled, true);
});

test("getInstalledPlugins returns empty when nothing is installed", async () => {
  await run(`CREATE (:ServerConfig { serverName: 'test-server' })`);
  const result = await env.resolvers.Query.getInstalledPlugins(null, {}, {});
  assert.deepEqual(result, []);
});
