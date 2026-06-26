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
