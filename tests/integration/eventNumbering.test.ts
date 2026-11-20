// Integration coverage for the per-forum event number that backs short,
// human-friendly URLs (/forums/cats/events/7-...). Exercises the real .cypher
// counter allocation in both the create and update (MERGE) paths, the
// (channelUniqueName, eventNumber) constraint, the number->id route lookup, and
// the startup backfill against a live Neo4j.
import assert from "node:assert/strict";
import { before, after, beforeEach, test } from "node:test";
import type { Driver } from "neo4j-driver";
import {
  createEventChannelQuery,
  updateEventChannelQuery,
} from "../../customResolvers/cypher/cypherQueries.js";
import { backfillEventChannelNumbers } from "../../services/eventNumberBackfill.js";
import { resolveEventIdByNumber } from "../../services/eventRouteLookup.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";

// Create only the constraint under test (not the whole core set), so this file
// never leaves pollinating constraints like Tag.text that other tests sharing a
// reused Testcontainers container do not expect.
const CONSTRAINT =
  "CREATE CONSTRAINT event_channel_number_unique IF NOT EXISTS FOR (ec:EventChannel) REQUIRE (ec.channelUniqueName, ec.eventNumber) IS UNIQUE";

let driver: Driver;

before(async () => {
  driver = await startNeo4j();
}, { timeout: 240000 });

beforeEach(async () => {
  await resetDatabase(driver);
});

after(async () => {
  await stopNeo4j();
});

const seed = async () => {
  await driver.executeQuery(
    "CREATE (:Channel {uniqueName:'forum', createdAt: datetime('2020-01-01T00:00:00Z')}), " +
      "(:Channel {uniqueName:'other', createdAt: datetime('2020-01-01T00:00:00Z')}), " +
      "(:User {username:'poster', notifyOnReplyToEventByDefault:false})"
  );
};

const makeEvent = async (id: string, createdAt = "2021-01-01T00:00:00Z") => {
  await driver.executeQuery(
    "CREATE (:Event {id:$id, title:$id, createdAt: datetime($createdAt)})",
    { id, createdAt }
  );
};

// Create an EventChannel through the real create-path cypher.
const connect = (eventId: string, channel: string) =>
  driver.executeQuery(createEventChannelQuery, {
    eventId,
    channelUniqueName: channel,
    poster: "poster",
  });

type NumberedChannel = { eventId: string; number: number };

const numbersIn = async (channel: string): Promise<NumberedChannel[]> => {
  const result = await driver.executeQuery(
    "MATCH (ec:EventChannel {channelUniqueName: $channel}) " +
      "RETURN ec.eventId AS eventId, ec.eventNumber AS number ORDER BY number",
    { channel }
  );
  return result.records.map((record) => ({
    eventId: record.get("eventId") as string,
    number: (record.get("number") as { toNumber?: () => number })?.toNumber?.() ??
      (record.get("number") as number),
  }));
};

test("new events get sequential per-forum numbers starting at 1", async () => {
  await seed();
  await makeEvent("e1");
  await makeEvent("e2");
  await makeEvent("e3");
  await connect("e1", "forum");
  await connect("e2", "forum");
  await connect("e3", "forum");
  assert.deepEqual((await numbersIn("forum")).map((e) => e.number), [1, 2, 3]);
});

test("event numbers are independent per forum", async () => {
  await seed();
  await makeEvent("e1");
  await makeEvent("e2");
  await connect("e1", "forum");
  await connect("e2", "other");
  await connect("e1", "other"); // crosspost of e1 into 'other'
  assert.deepEqual((await numbersIn("forum")).map((e) => e.number), [1]);
  assert.deepEqual((await numbersIn("other")).map((e) => e.number), [1, 2]);
});

test("re-running the create query for an existing connection consumes no number", async () => {
  await seed();
  await makeEvent("e1");
  await connect("e1", "forum");
  await connect("e1", "forum"); // idempotent: EventChannel already exists
  assert.deepEqual((await numbersIn("forum")).map((e) => e.number), [1]);
});

test("the update (MERGE) path allocates a number for a newly connected channel", async () => {
  await seed();
  await makeEvent("e1");
  // updateEventChannelQuery MERGE-creates the EventChannel (e.g. adding a
  // crosspost via an edit); it must still receive a number.
  await driver.executeQuery(updateEventChannelQuery, {
    eventId: "e1",
    channelUniqueName: "forum",
  });
  const numbered = await numbersIn("forum");
  assert.deepEqual(numbered.map((e) => e.number), [1]);
  // Running it again does not change the existing number.
  await driver.executeQuery(updateEventChannelQuery, {
    eventId: "e1",
    channelUniqueName: "forum",
  });
  assert.deepEqual((await numbersIn("forum")).map((e) => e.number), [1]);
});

test("(channelUniqueName, eventNumber) is unique", async () => {
  await seed();
  await driver.executeQuery(CONSTRAINT);
  await makeEvent("e1");
  await connect("e1", "forum");
  await assert.rejects(
    driver.executeQuery(
      "CREATE (:EventChannel {id:'dup', eventId:'x', channelUniqueName:'forum', eventNumber: 1})"
    ),
    /already exists|ConstraintValidationFailed|equivalent value/i
  );
});

test("resolveEventIdByNumber maps a number back to its event id", async () => {
  await seed();
  await makeEvent("e1");
  await makeEvent("e2");
  await connect("e1", "forum");
  await connect("e2", "forum");
  const second = (await numbersIn("forum")).find((e) => e.number === 2);
  assert.ok(second);
  const session = driver.session();
  try {
    assert.equal(await resolveEventIdByNumber(session, "forum", 2), second.eventId);
    assert.equal(await resolveEventIdByNumber(session, "forum", 999), null);
  } finally {
    await session.close();
  }
});

test("backfill numbers legacy EventChannels in creation order and seeds the counter", async () => {
  await seed();
  await driver.executeQuery(
    "CREATE (:EventChannel {id:'ec1', eventId:'e1', channelUniqueName:'forum', createdAt: datetime('2021-01-01T00:00:00Z')}), " +
      "(:EventChannel {id:'ec2', eventId:'e2', channelUniqueName:'forum', createdAt: datetime('2021-02-01T00:00:00Z')})"
  );

  const result = await backfillEventChannelNumbers(driver);
  assert.equal(result.eventChannelsNumbered, 2);
  assert.equal(result.channelsUpdated, 1);

  const byEvent = Object.fromEntries(
    (await numbersIn("forum")).map((e) => [e.eventId, e.number])
  );
  assert.equal(byEvent["e1"], 1, "oldest EventChannel is #1");
  assert.equal(byEvent["e2"], 2);

  // The counter is seeded, so a freshly created EventChannel continues at 3.
  await makeEvent("e3");
  await connect("e3", "forum");
  assert.ok(
    (await numbersIn("forum")).some((e) => e.number === 3),
    "next created event continues the sequence at 3"
  );

  // Running the backfill again is a no-op.
  const again = await backfillEventChannelNumbers(driver);
  assert.equal(again.eventChannelsNumbered, 0);
});
