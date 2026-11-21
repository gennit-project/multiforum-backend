// Integration coverage for the per-forum discussion number that backs short,
// human-friendly URLs (/forums/cats/discussions/42-...). Exercises the real
// .cypher counter allocation, the (channelUniqueName, discussionNumber)
// constraint, the number->id route lookup, and the startup backfill against a
// live Neo4j. Unit tests mock the driver and cannot cover any of this.
import assert from "node:assert/strict";
import { before, after, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";
import getCustomResolvers from "../helpers/getTestResolvers.js";
import typeDefs from "../../typeDefs.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { createDiscussionCreationRepository } from "../../services/persistence/discussionCreationRepository.js";
import { createDiscussionsFromInput } from "../../customResolvers/mutations/createDiscussionWithChannelConnections.js";
import { backfillDiscussionChannelNumbers } from "../../services/discussionNumberBackfill.js";
import { resolveDiscussionIdByNumber } from "../../services/discussionRouteLookup.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";

// Create only the constraint under test (not the whole core set), so this file
// never leaves pollinating constraints like Tag.text that other tests sharing a
// reused Testcontainers container do not expect.
const CONSTRAINT =
  "CREATE CONSTRAINT discussion_channel_number_unique IF NOT EXISTS FOR (dc:DiscussionChannel) REQUIRE (dc.channelUniqueName, dc.discussionNumber) IS UNIQUE";

let driver: Driver;

before(async () => {
  driver = await startNeo4j();
  const app = getCustomResolvers(driver);
  const neo = new Neo4jGraphQL({ driver, typeDefs, resolvers: app.resolvers });
  const schema = await neo.getSchema();
  registerGeneratedSchema(driver, schema);
}, { timeout: 240000 });

beforeEach(async () => {
  await resetDatabase(driver);
});

after(async () => {
  await stopNeo4j();
});

const noopPipelines = async () => {};

const seed = async () => {
  await driver.executeQuery(
    "CREATE (:Channel {uniqueName:'forum', createdAt: datetime('2020-01-01T00:00:00Z')}), " +
      "(:Channel {uniqueName:'other', createdAt: datetime('2020-01-01T00:00:00Z')}), " +
      "(:User {username:'author'})"
  );
};

const input = (title: string, channels: string[] = ["forum"]) => ({
  // Author is carried as an extra field the custom resolver strips/handles; v7
  // dropped it from the generated to-one input type, so cast like the sibling
  // discussionCreationRepository test does.
  discussionCreateInput: {
    title,
    body: "body",
    Author: { connect: { where: { node: { username: "author" } } } },
  } as unknown as Parameters<typeof createDiscussionsFromInput>[2][number]["discussionCreateInput"],
  channelConnections: channels,
});

const create = (title: string, channels?: string[]) =>
  createDiscussionsFromInput(
    createDiscussionCreationRepository(driver),
    driver,
    [input(title, channels)],
    undefined,
    noopPipelines
  );

type NumberedChannel = { id: string; number: number };

const numbersIn = async (channel: string): Promise<NumberedChannel[]> => {
  const result = await driver.executeQuery(
    "MATCH (dc:DiscussionChannel {channelUniqueName: $channel}) " +
      "RETURN dc.discussionId AS id, dc.discussionNumber AS number ORDER BY number",
    { channel }
  );
  return result.records.map((record) => ({
    id: record.get("id") as string,
    number: (record.get("number") as { toNumber?: () => number })?.toNumber?.() ??
      (record.get("number") as number),
  }));
};

test("new discussions get sequential per-forum numbers starting at 1", async () => {
  await seed();
  await create("First");
  await create("Second");
  await create("Third");
  assert.deepEqual(
    (await numbersIn("forum")).map((entry) => entry.number),
    [1, 2, 3]
  );
});

test("discussion numbers are independent per forum", async () => {
  await seed();
  await create("A", ["forum"]);
  await create("B", ["other"]);
  await create("C", ["forum"]);
  assert.deepEqual((await numbersIn("forum")).map((e) => e.number), [1, 2]);
  assert.deepEqual((await numbersIn("other")).map((e) => e.number), [1]);
});

test("a crosspost gets each forum's own next number", async () => {
  await seed();
  await create("Existing", ["other"]); // 'other' now at 1
  await create("Shared", ["forum", "other"]); // forum -> 1, other -> 2
  assert.deepEqual((await numbersIn("forum")).map((e) => e.number), [1]);
  assert.deepEqual((await numbersIn("other")).map((e) => e.number), [1, 2]);
});

test("(channelUniqueName, discussionNumber) is unique", async () => {
  await seed();
  await driver.executeQuery(CONSTRAINT);
  await create("First");
  await assert.rejects(
    driver.executeQuery(
      "CREATE (:DiscussionChannel {id:'dup', discussionId:'x', channelUniqueName:'forum', discussionNumber: 1})"
    ),
    /already exists|ConstraintValidationFailed|equivalent value/i
  );
});

test("resolveDiscussionIdByNumber maps a number back to its discussion id", async () => {
  await seed();
  await create("First");
  await create("Second");
  const entries = await numbersIn("forum");
  const second = entries.find((entry) => entry.number === 2);
  assert.ok(second);
  const session = driver.session();
  try {
    assert.equal(await resolveDiscussionIdByNumber(session, "forum", 2), second.id);
    assert.equal(await resolveDiscussionIdByNumber(session, "forum", 999), null);
  } finally {
    await session.close();
  }
});

test("backfill numbers legacy DiscussionChannels in creation order and seeds the counter", async () => {
  await seed();
  // Legacy rows created before the feature: no discussionNumber.
  await driver.executeQuery(
    "CREATE (:DiscussionChannel {id:'dc1', discussionId:'d1', channelUniqueName:'forum', createdAt: datetime('2021-01-01T00:00:00Z')}), " +
      "(:DiscussionChannel {id:'dc2', discussionId:'d2', channelUniqueName:'forum', createdAt: datetime('2021-02-01T00:00:00Z')})"
  );

  const result = await backfillDiscussionChannelNumbers(driver);
  assert.equal(result.discussionChannelsNumbered, 2);
  assert.equal(result.channelsUpdated, 1);

  const byDiscussion = Object.fromEntries(
    (await numbersIn("forum")).map((entry) => [entry.id, entry.number])
  );
  assert.equal(byDiscussion["d1"], 1, "oldest DiscussionChannel is #1");
  assert.equal(byDiscussion["d2"], 2);

  // The counter is seeded, so a freshly created discussion continues at 3.
  await create("New");
  const after = await numbersIn("forum");
  assert.ok(
    after.some((entry) => entry.number === 3),
    "next created discussion continues the sequence at 3"
  );

  // Running the backfill again is a no-op.
  const again = await backfillDiscussionChannelNumbers(driver);
  assert.equal(again.discussionChannelsNumbered, 0);
});
