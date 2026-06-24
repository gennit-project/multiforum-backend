// Integration tests for the getEventComments query resolver against a live
// Neo4j container. It fetches the Event via the OGM and its root comments via a
// Cypher query that supports top/hot/new sorting and pagination. Runs through
// the (anonymous-tolerant) auth seam.

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

const anonContext = () => ({
  driver: env.driver,
  ogm: env.ogm,
  req: { headers: {}, body: {} },
});

const getEventComments = (args: Record<string, unknown>) =>
  env.resolvers.Query.getEventComments(
    null,
    { offset: "0", limit: "10", sort: "new", ...args },
    anonContext()
  );

const seedEventWithComments = () =>
  run(
    `CREATE (e:Event { id: 'e1', title: 'Meetup', startTime: datetime(), endTime: datetime(), canceled: false, createdAt: datetime() })
     CREATE (c1:Comment { id: 'cm1', text: 'first', isRootComment: true, weightedVotesCount: 1, createdAt: datetime() })
     CREATE (c2:Comment { id: 'cm2', text: 'second', isRootComment: true, weightedVotesCount: 5, createdAt: datetime() })
     CREATE (reply:Comment { id: 'cm3', text: 'a reply', isRootComment: false, weightedVotesCount: 0, createdAt: datetime() })
     CREATE (e)-[:HAS_COMMENT]->(c1)
     CREATE (e)-[:HAS_COMMENT]->(c2)
     CREATE (e)-[:HAS_COMMENT]->(reply)`
  );

test("returns the event and its root comments, sorted by top (weighted votes)", async () => {
  await seedEventWithComments();

  const result = await getEventComments({ eventId: "e1", sort: "top" });

  assert.equal(result.Event?.id, "e1");
  assert.equal(result.Comments.length, 2, "only root comments are returned");
  assert.deepEqual(
    result.Comments.map((c: any) => c.id),
    ["cm2", "cm1"],
    "higher weighted-votes comment comes first under top sort"
  );
});

test("excludes non-root comments (replies)", async () => {
  await seedEventWithComments();

  const result = await getEventComments({ eventId: "e1", sort: "top" });
  assert.ok(
    !result.Comments.some((c: any) => c.id === "cm3"),
    "the reply (isRootComment false) is not in the event's comment section"
  );
});

test("paginates with limit", async () => {
  await seedEventWithComments();

  const result = await getEventComments({ eventId: "e1", sort: "top", limit: "1" });
  assert.equal(result.Comments.length, 1);
  assert.equal(result.Comments[0].id, "cm2", "first page under top sort is the top comment");
});

test("returns an empty section for an unknown event", async () => {
  const result = await getEventComments({ eventId: "missing" });
  assert.equal(result.Event, null);
  assert.deepEqual(result.Comments, []);
});
