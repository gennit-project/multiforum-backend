// Integration tests for the event-series UPDATE and DELETE resolvers against a
// live Neo4j container (issue #104): scope-aware edits/deletes across a series,
// plus the subscriber-notification path. The series is created through the real
// createEventSeriesWithChannelConnections resolver (fixed in #108), so this
// exercises the full create → update/delete → notify flow end-to-end.
// (createEventSeries's own graph shape is covered in createEventSeries.test.ts.)

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import getUpdateEventInSeriesResolver from "../../customResolvers/mutations/updateEventInSeries.js";
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
  process.env.FRONTEND_URL = "https://example.com";
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

const updateInSeriesWithEmailSpy = async (
  args: Record<string, unknown>,
  input: {
    actor?: string;
    sendBatchEmailsCalls: Array<any[]>;
  }
) => {
  const resolver = getUpdateEventInSeriesResolver({
    Event: env.ogm.model("Event") as any,
    EventSeries: env.ogm.model("EventSeries") as any,
    driver: env.driver as any,
    dependencies: {
      async sendBatchEmails(messages) {
        input.sendBatchEmailsCalls.push(messages);
        return true;
      },
    },
  });

  return resolver(
    null,
    { channelConnections: [], channelDisconnections: [], ...args } as any,
    { user: { username: input.actor || "poster" } } as any,
    null as any
  );
};

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

test("updateEventInSeries THIS_ONLY emails subscribed watchers with time-change summary", async () => {
  const occ = await createSeriesOccurrences();
  const sendBatchEmailsCalls: Array<any[]> = [];

  await run(
    `MATCH (edited:Event { id: $editedId })
     MATCH (other:Event { id: $otherId })
     MERGE (watcher:User { username: 'watcher' })
     MERGE (watcherEmail:Email { address: 'watcher@example.com' })
     MERGE (watcherEmail)-[:HAS_EMAIL]->(watcher)
     MERGE (watcher)-[:SUBSCRIBED_TO_EVENT_UPDATES]->(edited)
     WITH edited, other
     MATCH (poster:User { username: 'poster' })
     MERGE (posterEmail:Email { address: 'poster@example.com' })
     MERGE (posterEmail)-[:HAS_EMAIL]->(poster)
     MERGE (poster)-[:SUBSCRIBED_TO_EVENT_UPDATES]->(edited)
     WITH other
     MERGE (otherWatcher:User { username: 'other-watcher' })
     MERGE (otherWatcherEmail:Email { address: 'other@example.com' })
     MERGE (otherWatcherEmail)-[:HAS_EMAIL]->(otherWatcher)
     MERGE (otherWatcher)-[:SUBSCRIBED_TO_EVENT_UPDATES]->(other)`,
    { editedId: occ[1], otherId: occ[2] }
  );

  await updateInSeriesWithEmailSpy(
    {
      eventId: occ[1],
      scope: "THIS_ONLY",
      eventUpdateInput: {
        startTime: "2030-01-09T19:30:00.000Z",
        endTime: "2030-01-09T21:00:00.000Z",
      },
    },
    { sendBatchEmailsCalls }
  );

  assert.equal(sendBatchEmailsCalls.length, 1);
  assert.deepEqual(
    sendBatchEmailsCalls[0].map((message) => message.to),
    ["watcher@example.com"]
  );
  assert.match(sendBatchEmailsCalls[0][0].subject, /^Event updated:/);
  assert.match(sendBatchEmailsCalls[0][0].text, /Scope: This occurrence only/);
  assert.match(sendBatchEmailsCalls[0][0].text, /Time changed to/);
  assert.match(
    sendBatchEmailsCalls[0][0].html,
    /View the latest event details/
  );
});

test("updateEventInSeries THIS_AND_FUTURE emails edited-occurrence watchers with scope and location-title changes", async () => {
  const occ = await createSeriesOccurrences();
  const sendBatchEmailsCalls: Array<any[]> = [];

  await run(
    `MATCH (edited:Event { id: $editedId })
     MATCH (future:Event { id: $futureId })
     MERGE (watcher:User { username: 'watcher' })
     MERGE (watcherEmail:Email { address: 'watcher@example.com' })
     MERGE (watcherEmail)-[:HAS_EMAIL]->(watcher)
     MERGE (watcher)-[:SUBSCRIBED_TO_EVENT_UPDATES]->(edited)
     WITH future
     MERGE (futureWatcher:User { username: 'future-watcher' })
     MERGE (futureWatcherEmail:Email { address: 'future@example.com' })
     MERGE (futureWatcherEmail)-[:HAS_EMAIL]->(futureWatcher)
     MERGE (futureWatcher)-[:SUBSCRIBED_TO_EVENT_UPDATES]->(future)`,
    { editedId: occ[1], futureId: occ[2] }
  );

  await updateInSeriesWithEmailSpy(
    {
      eventId: occ[1],
      scope: "THIS_AND_FUTURE",
      eventUpdateInput: {
        title: "Future Weekly Meetup",
        locationName: "Town Hall",
      },
    },
    { sendBatchEmailsCalls }
  );

  assert.equal(sendBatchEmailsCalls.length, 1);
  assert.deepEqual(
    sendBatchEmailsCalls[0].map((message) => message.to),
    ["watcher@example.com"]
  );
  assert.equal(sendBatchEmailsCalls[0][0].subject, "Event updated: Future Weekly Meetup");
  assert.match(sendBatchEmailsCalls[0][0].text, /Scope: This and 1 future occurrence/);
  assert.match(sendBatchEmailsCalls[0][0].text, /Location changed to Town Hall\./);
  assert.match(sendBatchEmailsCalls[0][0].text, /Title changed to "Future Weekly Meetup"\./);
});

test("updateEventInSeries ALL_IN_SERIES emails edited-occurrence watchers with cancellation summary", async () => {
  const occ = await createSeriesOccurrences();
  const sendBatchEmailsCalls: Array<any[]> = [];

  await run(
    `MATCH (edited:Event { id: $editedId })
     MERGE (watcher:User { username: 'watcher' })
     MERGE (watcherEmail:Email { address: 'watcher@example.com' })
     MERGE (watcherEmail)-[:HAS_EMAIL]->(watcher)
     MERGE (watcher)-[:SUBSCRIBED_TO_EVENT_UPDATES]->(edited)`,
    { editedId: occ[0] }
  );

  await updateInSeriesWithEmailSpy(
    {
      eventId: occ[0],
      scope: "ALL_IN_SERIES",
      eventUpdateInput: {
        canceled: true,
      },
    },
    { sendBatchEmailsCalls }
  );

  assert.equal(sendBatchEmailsCalls.length, 1);
  assert.deepEqual(
    sendBatchEmailsCalls[0].map((message) => message.to),
    ["watcher@example.com"]
  );
  assert.match(sendBatchEmailsCalls[0][0].subject, /^Event canceled:/);
  assert.match(sendBatchEmailsCalls[0][0].text, /Scope: All 3 occurrences in the series/);
  assert.match(sendBatchEmailsCalls[0][0].text, /This event was canceled\./);
  assert.match(
    sendBatchEmailsCalls[0][0].text,
    /showCanceledEvents=true/
  );
});
