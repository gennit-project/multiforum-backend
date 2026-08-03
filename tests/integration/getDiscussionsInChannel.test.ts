// Integration test for the getDiscussionsInChannel resolver against live Neo4j.
// It runs the getDiscussionChannelsQuery.cypher (a heavy custom query). This test
// exercises the query end to end against a real database so the Cypher's syntax
// and variable threading are validated — it is the only coverage for that query.
// (Added alongside the tag-refactor contract, which simplified the query's
// serverRole/channelRole handling.)

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

const anon = () => ({
  driver: env.driver,
  ogm: env.ogm,
  req: { headers: {}, body: {} },
});

const callForSort = (sort: string) =>
  env.resolvers.Query.getDiscussionsInChannel(
    null,
    {
      channelUniqueName: "does-not-exist",
      options: { offset: "0", limit: "10", sort },
      selectedTags: [],
      searchInput: "",
      showArchived: false,
      labelFilters: [],
    },
    anon(),
    {} as never
  );

// Running the query against an empty DB validates that the Cypher parses and
// executes (the real risk in the contract change); a non-existent channel simply
// yields an empty result.
for (const sort of ["new", "top", "hot"]) {
  test(`getDiscussionsInChannel (${sort}) executes and returns an empty result for an unknown channel`, async () => {
    const result = await callForSort(sort);
    assert.deepEqual(result.discussionChannels, []);
    assert.equal(Number(result.aggregateDiscussionChannelsCount), 0);
  });
}

test("download label filters include matching packs and exclude excluded packs first", async () => {
  await run(
    `CREATE (owner:User { username: 'sims-builder', createdAt: datetime() })
     CREATE (channel:Channel { uniqueName: 'sims4_builds', displayName: 'Sims 4 Builds', createdAt: datetime() })
     CREATE (includePacks:FilterGroup { id: 'fg-include-packs', key: 'include_game_packs', displayName: 'Game Packs', order: 1, mode: 'INCLUDE' })
     CREATE (excludePacks:FilterGroup { id: 'fg-exclude-packs', key: 'exclude_game_packs', displayName: 'Game Packs', order: 2, mode: 'EXCLUDE' })
     CREATE (includeVampires:FilterOption { id: 'fo-include-vampires', value: 'vampires', displayName: 'Vampires', order: 1 })
     CREATE (includeDineOut:FilterOption { id: 'fo-include-dine-out', value: 'dine_out', displayName: 'Dine Out', order: 2 })
     CREATE (excludeVampires:FilterOption { id: 'fo-exclude-vampires', value: 'vampires', displayName: 'Vampires', order: 1 })
     CREATE (excludeDineOut:FilterOption { id: 'fo-exclude-dine-out', value: 'dine_out', displayName: 'Dine Out', order: 2 })
     CREATE (channel)-[:HAS_FILTER_GROUP]->(includePacks)
     CREATE (channel)-[:HAS_FILTER_GROUP]->(excludePacks)
     CREATE (includePacks)-[:HAS_FILTER_OPTION]->(includeVampires)
     CREATE (includePacks)-[:HAS_FILTER_OPTION]->(includeDineOut)
     CREATE (excludePacks)-[:HAS_FILTER_OPTION]->(excludeVampires)
     CREATE (excludePacks)-[:HAS_FILTER_OPTION]->(excludeDineOut)

     CREATE (vampireOnly:Discussion { id: 'disc-vampire-only', title: 'Vampire Manor', body: 'Uses Vampires only', hasDownload: true, createdAt: datetime() })
     CREATE (vampireRestaurant:Discussion { id: 'disc-vampire-restaurant', title: 'Vampire Restaurant', body: 'Uses Vampires and Dine Out', hasDownload: true, createdAt: datetime() })
     CREATE (dinerOnly:Discussion { id: 'disc-diner-only', title: 'Modern Diner', body: 'Uses Dine Out only', hasDownload: true, createdAt: datetime() })
     CREATE (owner)-[:POSTED_DISCUSSION]->(vampireOnly)
     CREATE (owner)-[:POSTED_DISCUSSION]->(vampireRestaurant)
     CREATE (owner)-[:POSTED_DISCUSSION]->(dinerOnly)
     CREATE (vampireOnly)-[:HAS_DOWNLOADABLE_FILE]->(:DownloadableFile { id: 'file-vampire-only', storageObjectName: 'uploads/sims-builder/vampire.zip' })
     CREATE (vampireRestaurant)-[:HAS_DOWNLOADABLE_FILE]->(:DownloadableFile { id: 'file-vampire-restaurant', storageObjectName: 'uploads/sims-builder/vampire-restaurant.zip' })
     CREATE (dinerOnly)-[:HAS_DOWNLOADABLE_FILE]->(:DownloadableFile { id: 'file-diner-only', storageObjectName: 'uploads/sims-builder/diner.zip' })

     CREATE (dcVampireOnly:DiscussionChannel { id: 'dc-vampire-only', discussionId: 'disc-vampire-only', channelUniqueName: 'sims4_builds', createdAt: datetime() })
     CREATE (dcVampireRestaurant:DiscussionChannel { id: 'dc-vampire-restaurant', discussionId: 'disc-vampire-restaurant', channelUniqueName: 'sims4_builds', createdAt: datetime() })
     CREATE (dcDinerOnly:DiscussionChannel { id: 'dc-diner-only', discussionId: 'disc-diner-only', channelUniqueName: 'sims4_builds', createdAt: datetime() })
     CREATE (dcVampireOnly)-[:POSTED_IN_CHANNEL]->(vampireOnly)
     CREATE (dcVampireOnly)-[:POSTED_IN_CHANNEL]->(channel)
     CREATE (dcVampireRestaurant)-[:POSTED_IN_CHANNEL]->(vampireRestaurant)
     CREATE (dcVampireRestaurant)-[:POSTED_IN_CHANNEL]->(channel)
     CREATE (dcDinerOnly)-[:POSTED_IN_CHANNEL]->(dinerOnly)
     CREATE (dcDinerOnly)-[:POSTED_IN_CHANNEL]->(channel)
     CREATE (dcVampireOnly)-[:HAS_LABEL_OPTION]->(includeVampires)
     CREATE (dcVampireRestaurant)-[:HAS_LABEL_OPTION]->(includeVampires)
     CREATE (dcVampireRestaurant)-[:HAS_LABEL_OPTION]->(excludeDineOut)
     CREATE (dcDinerOnly)-[:HAS_LABEL_OPTION]->(excludeDineOut)`
  );

  const result = await env.resolvers.Query.getDiscussionsInChannel(
    null,
    {
      channelUniqueName: "sims4_builds",
      options: { offset: "0", limit: "10", sort: "new" },
      selectedTags: [],
      searchInput: "",
      showArchived: false,
      hasDownload: true,
      labelFilters: [
        { groupKey: "include_game_packs", values: ["vampires"] },
        { groupKey: "exclude_game_packs", values: ["dine_out"] },
      ],
    },
    anon(),
    {} as never
  );

  const titles = result.discussionChannels.map(
    (discussionChannel: any) => discussionChannel.Discussion.title
  );

  assert.deepEqual(titles, ["Vampire Manor"]);
  assert.equal(Number(result.aggregateDiscussionChannelsCount), 1);
});

test("channel and sitewide discussion lists return assigned flairs, including archived history", async () => {
  await run(
    `CREATE (owner:User { username: 'alice', createdAt: datetime() })
     CREATE (cats:Channel { uniqueName: 'cats', displayName: 'Cats', createdAt: datetime() })
     CREATE (discussion:Discussion { id: 'discussion-1', title: 'Flair history', body: '', hasDownload: false, createdAt: datetime() })
     CREATE (dc:DiscussionChannel { id: 'dc-1', discussionId: 'discussion-1', channelUniqueName: 'cats', createdAt: datetime(), archived: false })
     CREATE (question:DiscussionFlair { id: 'question', channelUniqueName: 'cats', displayName: 'Question', color: '#112233', order: 0, archived: false })
     CREATE (legacy:DiscussionFlair { id: 'legacy', channelUniqueName: 'cats', displayName: 'Legacy', color: null, order: 1, archived: true })
     CREATE (owner)-[:POSTED_DISCUSSION]->(discussion)
     CREATE (dc)-[:POSTED_IN_CHANNEL]->(discussion)
     CREATE (dc)-[:POSTED_IN_CHANNEL]->(cats)
     CREATE (cats)-[:HAS_DISCUSSION_FLAIR]->(question)
     CREATE (cats)-[:HAS_DISCUSSION_FLAIR]->(legacy)
     CREATE (dc)-[:HAS_DISCUSSION_FLAIR]->(question)
     CREATE (dc)-[:HAS_DISCUSSION_FLAIR]->(legacy)`
  );

  const channelResult = await env.resolvers.Query.getDiscussionsInChannel(
    null,
    {
      channelUniqueName: "cats",
      options: { offset: "0", limit: "10", sort: "new" },
      selectedTags: [],
      searchInput: "",
      showArchived: false,
      showUnanswered: false,
      hasDownload: false,
      labelFilters: [],
    },
    anon(),
    {} as never
  );

  const sitewideResult = await env.resolvers.Query.getSiteWideDiscussionList(
    null,
    {
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
    },
    anon(),
    {} as never
  );

  const expectedFlairs = [
    {
      id: "question",
      channelUniqueName: "cats",
      displayName: "Question",
      color: "#112233",
      order: 0,
      archived: false,
    },
    {
      id: "legacy",
      channelUniqueName: "cats",
      displayName: "Legacy",
      color: null,
      order: 1,
      archived: true,
    },
  ];
  const normalizeFlairs = (flairs: Array<Record<string, unknown>>) =>
    flairs
      .map((flair) => ({ ...flair, order: Number(flair.order) }))
      .sort((left, right) => left.order - right.order);

  assert.deepEqual(
    normalizeFlairs(channelResult.discussionChannels[0].Flairs),
    expectedFlairs
  );
  assert.deepEqual(
    normalizeFlairs(sitewideResult.discussions[0].DiscussionChannels[0].Flairs),
    expectedFlairs
  );
});

test("sitewide discussion lists return scan metadata only for non-removed downloads", async () => {
  await run(
    `CREATE (owner:User { username: 'alice', createdAt: datetime() })
     CREATE (channel:Channel { uniqueName: 'downloads', displayName: 'Downloads', createdAt: datetime() })
     CREATE (discussion:Discussion { id: 'download-1', title: 'Safe download', body: '', hasDownload: true, createdAt: datetime() })
     CREATE (dc:DiscussionChannel { id: 'dc-download-1', discussionId: 'download-1', channelUniqueName: 'downloads', createdAt: datetime(), archived: false })
     CREATE (publicFile:DownloadableFile { id: 'file-public', scanStatus: 'CLEAN', permanentlyRemoved: false })
     CREATE (removedFile:DownloadableFile { id: 'file-removed', scanStatus: 'INFECTED', permanentlyRemoved: true })
     CREATE (owner)-[:POSTED_DISCUSSION]->(discussion)
     CREATE (dc)-[:POSTED_IN_CHANNEL]->(discussion)
     CREATE (dc)-[:POSTED_IN_CHANNEL]->(channel)
     CREATE (discussion)-[:HAS_DOWNLOADABLE_FILE]->(publicFile)
     CREATE (discussion)-[:HAS_DOWNLOADABLE_FILE]->(removedFile)`
  );

  const result = await env.resolvers.Query.getSiteWideDiscussionList(
    null,
    {
      searchInput: "",
      selectedChannels: [],
      selectedTags: [],
      showArchived: false,
      hasDownload: true,
      options: {
        offset: "0",
        limit: "10",
        resultsOrder: "desc",
        sort: "new",
        timeFrame: "week",
      },
    },
    anon(),
    {} as never
  );

  assert.deepEqual(result.discussions[0].DownloadableFiles, [
    { id: "file-public", scanStatus: "CLEAN" },
  ]);
});

test("channel discussion lists return scan metadata only for non-removed downloads", async () => {
  await run(
    `CREATE (owner:User { username: 'alice', createdAt: datetime() })
     CREATE (channel:Channel { uniqueName: 'downloads', displayName: 'Downloads', createdAt: datetime() })
     CREATE (discussion:Discussion { id: 'download-1', title: 'Safe download', body: '', hasDownload: true, createdAt: datetime() })
     CREATE (dc:DiscussionChannel { id: 'dc-download-1', discussionId: 'download-1', channelUniqueName: 'downloads', createdAt: datetime(), archived: false })
     CREATE (publicFile:DownloadableFile { id: 'file-public', scanStatus: 'CLEAN', permanentlyRemoved: false })
     CREATE (removedFile:DownloadableFile { id: 'file-removed', scanStatus: 'INFECTED', permanentlyRemoved: true })
     CREATE (owner)-[:POSTED_DISCUSSION]->(discussion)
     CREATE (dc)-[:POSTED_IN_CHANNEL]->(discussion)
     CREATE (dc)-[:POSTED_IN_CHANNEL]->(channel)
     CREATE (discussion)-[:HAS_DOWNLOADABLE_FILE]->(publicFile)
     CREATE (discussion)-[:HAS_DOWNLOADABLE_FILE]->(removedFile)`
  );

  const result = await env.resolvers.Query.getDiscussionsInChannel(
    null,
    {
      channelUniqueName: "downloads",
      options: { offset: "0", limit: "10", sort: "new", timeFrame: "week" },
      selectedTags: [],
      searchInput: "",
      showArchived: false,
      showUnanswered: false,
      hasDownload: true,
      labelFilters: [],
    },
    anon(),
    {} as never
  );

  assert.deepEqual(result.discussionChannels[0].Discussion.DownloadableFiles, [
    { id: "file-public", scanStatus: "CLEAN" },
  ]);
});
