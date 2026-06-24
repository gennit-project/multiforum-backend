// Integration tests for createEventWithChannelConnections against a live Neo4j
// container. The resolver creates each Event via the OGM, then links it to the
// requested channels with a raw-Cypher EventChannel (skipping duplicates and
// subscribing the poster when they've opted in). The channel-link query MATCHes
// the poster User, so that user must exist.

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

const createEvents = (input: any[], poster = "poster") =>
  env.resolvers.Mutation.createEventWithChannelConnections(
    null,
    { input },
    { user: { username: poster } }
  );

const eventInput = (overrides: Record<string, unknown> = {}) => ({
  title: "My Event",
  startTime: "2026-06-01T10:00:00.000Z",
  endTime: "2026-06-01T12:00:00.000Z",
  canceled: false,
  ...overrides,
});

test("creates an event and links it to the requested channel via an EventChannel", async () => {
  await run(
    `CREATE (:Channel { uniqueName: 'cats', createdAt: datetime() })
     CREATE (:User { username: 'poster' })`
  );

  const events = await createEvents([
    { eventCreateInput: eventInput(), channelConnections: ["cats"] },
  ]);

  assert.equal(events.length, 1, "one event returned");
  assert.equal(events[0].title, "My Event");

  const rows = await run(
    `MATCH (e:Event { title: 'My Event' })<-[:POSTED_IN_CHANNEL]-(ec:EventChannel)-[:POSTED_IN_CHANNEL]->(ch:Channel)
     RETURN ec.channelUniqueName AS channel, ch.uniqueName AS linkedChannel, ec.eventId AS eventId, e.id AS eId`
  );
  assert.equal(rows.length, 1, "an EventChannel links the event to the channel");
  assert.equal(rows[0].channel, "cats");
  assert.equal(rows[0].linkedChannel, "cats");
  assert.equal(rows[0].eventId, rows[0].eId, "EventChannel.eventId matches the event");
});

test("links an event to multiple channels", async () => {
  await run(
    `CREATE (:Channel { uniqueName: 'cats', createdAt: datetime() })
     CREATE (:Channel { uniqueName: 'dogs', createdAt: datetime() })
     CREATE (:User { username: 'poster' })`
  );

  await createEvents([
    { eventCreateInput: eventInput(), channelConnections: ["cats", "dogs"] },
  ]);

  const channels = await run(
    `MATCH (e:Event { title: 'My Event' })<-[:POSTED_IN_CHANNEL]-(ec:EventChannel)
     RETURN ec.channelUniqueName AS channel ORDER BY channel`
  );
  assert.deepEqual(channels.map((c: any) => c.channel), ["cats", "dogs"]);
});

test("does not create a duplicate EventChannel for a repeated channel connection", async () => {
  await run(
    `CREATE (:Channel { uniqueName: 'cats', createdAt: datetime() })
     CREATE (:User { username: 'poster' })`
  );

  await createEvents([
    { eventCreateInput: eventInput(), channelConnections: ["cats", "cats"] },
  ]);

  const ecs = await run(
    `MATCH (ec:EventChannel { channelUniqueName: 'cats' }) RETURN count(ec) AS n`
  );
  assert.equal(Number(ecs[0].n), 1, "the duplicate connection is skipped");
});

test("skips an event that has no channel connections", async () => {
  await run(`CREATE (:User { username: 'poster' })`);

  const events = await createEvents([
    { eventCreateInput: eventInput(), channelConnections: [] },
  ]);

  assert.equal(events.length, 0, "no event returned");
  const created = await run(`MATCH (e:Event) RETURN count(e) AS n`);
  assert.equal(Number(created[0].n), 0, "no event node created");
});

test("subscribes the poster to event notifications when they have opted in", async () => {
  await run(
    `CREATE (:Channel { uniqueName: 'cats', createdAt: datetime() })
     CREATE (:User { username: 'poster', notifyOnReplyToEventByDefault: true })`
  );

  await createEvents([
    { eventCreateInput: eventInput(), channelConnections: ["cats"] },
  ]);

  const subs = await run(
    `MATCH (:User { username: 'poster' })-[:SUBSCRIBED_TO_NOTIFICATIONS]->(e:Event)
     RETURN count(e) AS n`
  );
  assert.equal(Number(subs[0].n), 1, "the opted-in poster is subscribed to the event");
});
