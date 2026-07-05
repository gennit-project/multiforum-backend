// Integration tests for the getSortedChannels query resolver against a live
// Neo4j container. It's a pure read resolver (no auth) whose inline Cypher does
// search-term filtering, tag filtering, two sub-counts (active DiscussionChannels
// honoring the countDownloads flag, and future EventChannels), and pagination.
// These tests validate that Cypher end to end.

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

// countDownloads is passed straight to Cypher; GraphQL would supply null when
// omitted, so default it here (a direct call would otherwise pass undefined,
// which the driver rejects).
const getSortedChannels = (
  args: Record<string, unknown> = {},
  context: Record<string, unknown> = {}
) =>
  env.resolvers.Query.getSortedChannels(
    null,
    { countDownloads: null, ...args },
    context
  );

const num = (v: any) => (v?.toNumber ? v.toNumber() : v);
const names = (channels: any[]) => channels.map((c) => c.uniqueName).sort();

// Three channels; "cats" carries a tag, a (non-download) discussion, and a
// future event so the sub-counts have something to count.
const seedChannels = () =>
  run(
    `CREATE (cats:Channel { uniqueName: 'cats', displayName: 'Cats', description: 'all about cats', createdAt: datetime() })
     CREATE (dogs:Channel { uniqueName: 'dogs', displayName: 'Dogs', description: 'all about dogs', createdAt: datetime() })
     CREATE (cars:Channel { uniqueName: 'cars', displayName: 'Cars', description: 'vroom vroom', createdAt: datetime() })
     CREATE (cats)-[:HAS_TAG]->(:Tag { text: 'pets' })
     CREATE (dogs)-[:HAS_TAG]->(:Tag { text: 'pets' })
     CREATE (cars)-[:HAS_TAG]->(:Tag { text: 'vehicles' })
     CREATE (d:Discussion { id: 'd1', title: 'meow', hasDownload: false, createdAt: datetime() })
     CREATE (dc:DiscussionChannel { id: 'dc1', discussionId: 'd1', channelUniqueName: 'cats', createdAt: datetime() })
     CREATE (dc)-[:POSTED_IN_CHANNEL]->(d)
     CREATE (dc)-[:POSTED_IN_CHANNEL]->(cats)
     CREATE (e:Event { id: 'e1', title: 'cat meetup', startTime: datetime(), endTime: datetime() + duration({days: 7}), canceled: false, createdAt: datetime() })
     CREATE (ec:EventChannel { id: 'ec1', channelUniqueName: 'cats', eventId: 'e1', createdAt: datetime() })
     CREATE (ec)-[:POSTED_IN_CHANNEL]->(e)
     CREATE (ec)-[:POSTED_IN_CHANNEL]->(cats)`
  );

const channelByName = (result: any, uniqueName: string) =>
  result.channels.find((c: any) => c.uniqueName === uniqueName);

test("returns all channels with their event/discussion sub-counts when unfiltered", async () => {
  await seedChannels();

  const result = await getSortedChannels();
  assert.deepEqual(names(result.channels), ["cars", "cats", "dogs"]);
  assert.equal(num(result.aggregateChannelCount), 3);

  const cats = channelByName(result, "cats");
  assert.equal(num(cats.DiscussionChannelsAggregate.count), 1, "one non-download discussion");
  assert.equal(num(cats.EventChannelsAggregate.count), 1, "one future event");

  const dogs = channelByName(result, "dogs");
  assert.equal(num(dogs.DiscussionChannelsAggregate.count), 0);
  assert.equal(num(dogs.EventChannelsAggregate.count), 0);
});

test("filters by search term across uniqueName and description", async () => {
  await seedChannels();

  const byName = await getSortedChannels({ searchInput: "dog" });
  assert.deepEqual(names(byName.channels), ["dogs"]);

  const byDescription = await getSortedChannels({ searchInput: "vroom" });
  assert.deepEqual(names(byDescription.channels), ["cars"]);
});

test("filters by tag", async () => {
  await seedChannels();

  const pets = await getSortedChannels({ tags: ["pets"] });
  assert.deepEqual(names(pets.channels), ["cats", "dogs"]);

  const vehicles = await getSortedChannels({ tags: ["vehicles"] });
  assert.deepEqual(names(vehicles.channels), ["cars"]);
});

test("paginates with limit and offset", async () => {
  await seedChannels();

  const page = await getSortedChannels({ limit: "2", offset: "0" });
  assert.equal(page.channels.length, 2, "limited to two channels");
  assert.equal(num(page.aggregateChannelCount), 3, "aggregate still reflects the full match");
});

test("countDownloads flag excludes non-download discussions from the count", async () => {
  await seedChannels();

  // The seeded discussion has hasDownload: false, so requesting download counts
  // should yield zero for cats.
  const withDownloads = await getSortedChannels({ countDownloads: true });
  assert.equal(
    num(channelByName(withDownloads, "cats").DiscussionChannelsAggregate.count),
    0,
    "non-download discussion is not counted when countDownloads is true"
  );

  // Default (null) counts non-download discussions.
  const defaultCount = await getSortedChannels();
  assert.equal(
    num(channelByName(defaultCount, "cats").DiscussionChannelsAggregate.count),
    1
  );
});

test("returns favorite state for the logged-in user", async () => {
  await seedChannels();
  await run(
    `MATCH (cats:Channel { uniqueName: 'cats' })
     CREATE (alice:User { username: 'alice' })
     CREATE (alice)-[:DEFAULT_FAVORITES_CHANNELS]->(cats)`
  );

  const result = await getSortedChannels(
    {},
    { user: { username: "alice", email: null, email_verified: true, data: null } }
  );

  assert.equal(channelByName(result, "cats").isFavorited, true);
  assert.equal(channelByName(result, "dogs").isFavorited, false);
});
