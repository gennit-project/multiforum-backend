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
