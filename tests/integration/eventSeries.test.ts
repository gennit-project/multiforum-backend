// Integration tests for the event-series UPDATE and DELETE resolvers against a
// live Neo4j container (issue #104): scope-aware edits/deletes across a series,
// plus the subscriber-notification path. The series is created through the real
// createEventSeriesWithChannelConnections resolver (fixed in #108), so this
// exercises the full create → update/delete → notify flow end-to-end.
// (createEventSeries's own graph shape is covered in createEventSeries.test.ts.)

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

const seriesInput = () => ({
  title: "Weekly Meetup",
  description: "Every Wednesday",
  channelConnections: ["cats"],
  occurrences: [
    { startTime: "2030-01-02T18:00:00.000Z", endTime: "2030-01-02T20:00:00.000Z" },
    { startTime: "2030-01-09T18:00:00.000Z", endTime: "2030-01-09T20:00:00.000Z" },
    { startTime: "2030-01-16T18:00:00.000Z", endTime: "2030-01-16T20:00:00.000Z" },
  ],
  repeatPattern: {
    type: "WEEKLY",
    count: 1,
    daysOfWeek: [3],
    endType: "AFTER_COUNT",
    endCount: 3,
    endDate: null,
  },
});

// Create a 3-occurrence series via the real resolver and return the occurrence
// ids ordered by occurrenceIndex.
const createSeriesOccurrences = async (): Promise<string[]> => {
  await env.resolvers.Mutation.createEventSeriesWithChannelConnections(
    null,
    { input: seriesInput() },
    { user: { username: "poster" } }
  );
  const rows = await run(
    `MATCH (:EventSeries)-[:HAS_OCCURRENCE]->(e:Event)
     RETURN e.id AS id ORDER BY e.occurrenceIndex`
  );
  return rows.map((r) => r.id as string);
};

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
  const occ = await createSeriesOccurrences();

  await updateInSeries({
    eventId: occ[0],
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
  const occ = await createSeriesOccurrences();

  // Edit the middle occurrence (index 1).
  await updateInSeries({
    eventId: occ[1],
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
  const occ = await createSeriesOccurrences();

  await updateInSeries({
    eventId: occ[1],
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
  const occ = await createSeriesOccurrences();

  const result = await deleteInSeries({ eventId: occ[1], scope: "THIS_ONLY" });

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
  const occ = await createSeriesOccurrences();

  await deleteInSeries({ eventId: occ[1], scope: "THIS_AND_FUTURE" });

  const remaining = await run(
    `MATCH (e:Event) RETURN e.occurrenceIndex AS idx ORDER BY idx`
  );
  assert.deepEqual(remaining.map((r) => Number(r.idx)), [0]);
});

test("deleteEventInSeries ALL_IN_SERIES removes every occurrence and the series", async () => {
  const occ = await createSeriesOccurrences();

  await deleteInSeries({ eventId: occ[0], scope: "ALL_IN_SERIES" });

  const events = await run(`MATCH (e:Event) RETURN count(e) AS n`);
  const series = await run(`MATCH (s:EventSeries) RETURN count(s) AS n`);
  assert.deepEqual(
    { events: Number(events[0].n), series: Number(series[0].n) },
    { events: 0, series: 0 }
  );
});

// --- notifications ---

test("updateEventInSeries notifies subscribers of the edited occurrence but not the acting user", async () => {
  const occ = await createSeriesOccurrences();

  // A watcher and the actor (poster) both subscribe to the edited occurrence.
  await run(
    `MATCH (e:Event { id: $occId })
     MERGE (w:User { username: 'watcher' })
     MERGE (w)-[:SUBSCRIBED_TO_EVENT_UPDATES]->(e)
     WITH e
     MATCH (p:User { username: 'poster' })
     MERGE (p)-[:SUBSCRIBED_TO_EVENT_UPDATES]->(e)`,
    { occId: occ[0] }
  );

  await updateInSeries(
    {
      eventId: occ[0],
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
