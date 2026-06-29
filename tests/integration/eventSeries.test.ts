// Integration tests for the event-series UPDATE and DELETE resolvers against a
// live Neo4j container (issue #104): scope-aware edits/deletes across a series,
// plus the subscriber-notification path. We seed the EventSeries graph directly
// via Cypher rather than through createEventSeriesWithChannelConnections, which
// is currently broken end-to-end against the real OGM (see
// gennit-project/multiforum-backend#108) — that resolver needs its own fix +
// coverage. The update/delete/notification logic is the more involved part and
// is fully exercised here.

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
  await run(
    `CREATE (:Channel { uniqueName: 'cats', createdAt: datetime() })
     CREATE (:User { username: 'poster' })`
  );
});

// Seed a 3-occurrence series with deterministic occurrence ids (occ-0..occ-2),
// indexed in order and linked to the series via HAS_OCCURRENCE.
const seedSeries = () =>
  run(
    `CREATE (s:EventSeries { id: 'series-1', title: 'Weekly Meetup', createdAt: datetime() })
     WITH s
     UNWIND range(0, 2) AS i
     CREATE (s)-[:HAS_OCCURRENCE]->(:Event {
       id: 'occ-' + toString(i),
       title: 'Weekly Meetup',
       description: 'Every Wednesday',
       occurrenceIndex: i,
       canceled: false,
       deleted: false,
       startTime: datetime({ year: 2030, month: 1, day: 2 + 7 * i, hour: 18 }),
       endTime: datetime({ year: 2030, month: 1, day: 2 + 7 * i, hour: 20 }),
       createdAt: datetime()
     })`
  );

const updateInSeries = (args: Record<string, unknown>, actor = "poster") =>
  env.resolvers.Mutation.updateEventInSeries(
    null,
    { channelConnections: [], channelDisconnections: [], ...args },
    { user: { username: actor } }
  );

const deleteInSeries = (args: Record<string, unknown>) =>
  env.resolvers.Mutation.deleteEventInSeries(null, args, {
    user: { username: "poster" },
  });

const titlesByIndex = async () =>
  (
    await run(
      `MATCH (:EventSeries)-[:HAS_OCCURRENCE]->(e:Event)
       RETURN e.title AS title ORDER BY e.occurrenceIndex`
    )
  ).map((r) => r.title);

// --- update scopes ---

test("updateEventInSeries ALL_IN_SERIES applies a title change to every occurrence", async () => {
  await seedSeries();

  await updateInSeries({
    eventId: "occ-0",
    scope: "ALL_IN_SERIES",
    eventUpdateInput: { title: "Renamed Meetup" },
  });

  assert.deepEqual(await titlesByIndex(), [
    "Renamed Meetup",
    "Renamed Meetup",
    "Renamed Meetup",
  ]);
});

test("updateEventInSeries THIS_AND_FUTURE changes the edited occurrence and later ones only", async () => {
  await seedSeries();

  // Edit the middle occurrence (index 1).
  await updateInSeries({
    eventId: "occ-1",
    scope: "THIS_AND_FUTURE",
    eventUpdateInput: { title: "Future Meetup" },
  });

  assert.deepEqual(await titlesByIndex(), [
    "Weekly Meetup",
    "Future Meetup",
    "Future Meetup",
  ]);
});

test("updateEventInSeries THIS_ONLY changes only the edited occurrence", async () => {
  await seedSeries();

  await updateInSeries({
    eventId: "occ-1",
    scope: "THIS_ONLY",
    eventUpdateInput: { title: "Just This One" },
  });

  assert.deepEqual(await titlesByIndex(), [
    "Weekly Meetup",
    "Just This One",
    "Weekly Meetup",
  ]);
});

// --- delete scopes ---

test("deleteEventInSeries THIS_ONLY removes one occurrence and keeps the series", async () => {
  await seedSeries();

  const result = await deleteInSeries({ eventId: "occ-1", scope: "THIS_ONLY" });

  const events = await run(`MATCH (e:Event) RETURN count(e) AS n`);
  const series = await run(`MATCH (s:EventSeries) RETURN count(s) AS n`);
  assert.deepEqual(
    {
      deletedCount: result.deletedCount,
      remainingEvents: Number(events[0].n),
      seriesKept: Number(series[0].n),
    },
    { deletedCount: 1, remainingEvents: 2, seriesKept: 1 }
  );
});

test("deleteEventInSeries THIS_AND_FUTURE removes the edited occurrence and later ones", async () => {
  await seedSeries();

  await deleteInSeries({ eventId: "occ-1", scope: "THIS_AND_FUTURE" });

  const remaining = await run(
    `MATCH (e:Event) RETURN e.occurrenceIndex AS idx ORDER BY idx`
  );
  assert.deepEqual(remaining.map((r) => Number(r.idx)), [0]);
});

test("deleteEventInSeries ALL_IN_SERIES removes every occurrence and the series", async () => {
  await seedSeries();

  await deleteInSeries({ eventId: "occ-0", scope: "ALL_IN_SERIES" });

  const events = await run(`MATCH (e:Event) RETURN count(e) AS n`);
  const series = await run(`MATCH (s:EventSeries) RETURN count(s) AS n`);
  assert.deepEqual(
    { events: Number(events[0].n), series: Number(series[0].n) },
    { events: 0, series: 0 }
  );
});

// --- notifications ---

test("updateEventInSeries notifies subscribers of the edited occurrence but not the acting user", async () => {
  await seedSeries();

  // A watcher and the actor (poster) both subscribe to the edited occurrence.
  await run(
    `MATCH (e:Event { id: 'occ-0' })
     CREATE (:User { username: 'watcher' })-[:SUBSCRIBED_TO_EVENT_UPDATES]->(e)
     WITH e
     MATCH (p:User { username: 'poster' })
     CREATE (p)-[:SUBSCRIBED_TO_EVENT_UPDATES]->(e)`
  );

  await updateInSeries(
    {
      eventId: "occ-0",
      scope: "ALL_IN_SERIES",
      eventUpdateInput: { title: "Renamed Meetup" },
    },
    "poster"
  );

  const notified = await run(
    `MATCH (u:User)-[:HAS_NOTIFICATION]->(n:Notification { notificationType: 'event' })
     RETURN collect(u.username) AS users, collect(n.text)[0] AS sampleText`
  );
  assert.deepEqual(
    {
      users: notified[0].users,
      mentionsUpdate: /was updated/.test(notified[0].sampleText ?? ""),
    },
    { users: ["watcher"], mentionsUpdate: true }
  );
});
