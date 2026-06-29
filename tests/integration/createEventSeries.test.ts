// Integration tests for createEventSeriesWithChannelConnections against a live
// Neo4j container. This resolver was previously broken end-to-end against the
// real OGM (input-name collision + an unpersistable repeatPattern object field
// — see #108); these tests prove the fix: it now creates the EventSeries, its
// indexed occurrences, their channel links, and the repeat-pattern node.

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

const seriesInput = (overrides: Record<string, unknown> = {}) => ({
  title: "Weekly Meetup",
  description: "Every Wednesday",
  channelConnections: ["cats"],
  tags: ["social"],
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
  ...overrides,
});

const createSeries = (overrides: Record<string, unknown> = {}, poster = "poster") =>
  env.resolvers.Mutation.createEventSeriesWithChannelConnections(
    null,
    { input: seriesInput(overrides) },
    { user: { username: poster } }
  );

test("createEventSeries returns the series with one occurrence per date, indexed in order", async () => {
  const series = await createSeries();

  assert.deepEqual(
    {
      title: series.title,
      count: series.Occurrences.length,
      indexes: series.Occurrences.map(
        (o: { occurrenceIndex: number }) => o.occurrenceIndex
      ).sort(),
    },
    { title: "Weekly Meetup", count: 3, indexes: [0, 1, 2] }
  );
});

test("createEventSeries persists the series and its occurrences in the graph", async () => {
  await createSeries();

  const rows = await run(
    `MATCH (s:EventSeries)-[:HAS_OCCURRENCE]->(e:Event)
     RETURN e.occurrenceIndex AS idx ORDER BY idx`
  );
  assert.deepEqual(rows.map((r) => Number(r.idx)), [0, 1, 2]);
});

test("createEventSeries links every occurrence to the requested channel via an EventChannel", async () => {
  await createSeries();

  const ecs = await run(
    `MATCH (e:Event)<-[:POSTED_IN_CHANNEL]-(ec:EventChannel { channelUniqueName: 'cats' })
     RETURN count(ec) AS n`
  );
  assert.equal(Number(ecs[0].n), 3);
});

test("createEventSeries creates a linked RepeatPattern node", async () => {
  await createSeries();

  const rows = await run(
    `MATCH (:EventSeries)-[:HAS_REPEAT_PATTERN]->(rp:RepeatPattern)
     RETURN rp.type AS type, rp.endCount AS endCount, rp.daysOfWeek AS daysOfWeek`
  );
  assert.deepEqual(
    {
      type: rows[0]?.type,
      endCount: rows[0] ? Number(rows[0].endCount) : null,
      daysOfWeek: rows[0]?.daysOfWeek?.map((d: unknown) => Number(d)),
    },
    { type: "WEEKLY", endCount: 3, daysOfWeek: [3] }
  );
});

test("createEventSeries links the poster to the series", async () => {
  await createSeries();

  const rows = await run(
    `MATCH (s:EventSeries)<-[:POSTED_BY]-(u:User) RETURN u.username AS poster`
  );
  assert.equal(rows[0]?.poster, "poster");
});

test("createEventSeries rejects a series with no channel connections", async () => {
  await assert.rejects(
    createSeries({ channelConnections: [] }),
    /channel connection is required/i
  );
});
