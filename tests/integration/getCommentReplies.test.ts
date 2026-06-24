// Integration tests for the getCommentReplies query resolver against a live
// Neo4j container. It fetches the direct replies (IS_REPLY_TO children) of a
// parent comment via Cypher with top/hot/new sorting + pagination, and returns
// an OGM aggregate count of all children. Runs through the anonymous-tolerant
// auth seam.

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

const getCommentReplies = (args: Record<string, unknown>) =>
  env.resolvers.Query.getCommentReplies(
    null,
    { modName: "", offset: "0", limit: "10", sort: "new", ...args },
    anonContext()
  );

const seedParentWithReplies = () =>
  run(
    `CREATE (p:Comment { id: 'p1', text: 'parent', isRootComment: true, createdAt: datetime() })
     CREATE (r1:Comment { id: 'r1', text: 'reply 1', isRootComment: false, weightedVotesCount: 1, createdAt: datetime() })
     CREATE (r2:Comment { id: 'r2', text: 'reply 2', isRootComment: false, weightedVotesCount: 5, createdAt: datetime() })
     CREATE (r1)-[:IS_REPLY_TO]->(p)
     CREATE (r2)-[:IS_REPLY_TO]->(p)`
  );

test("returns the parent comment's replies sorted by top, with an aggregate count", async () => {
  await seedParentWithReplies();

  const result = await getCommentReplies({ commentId: "p1", sort: "top" });

  assert.equal(result.ChildComments.length, 2);
  assert.deepEqual(
    result.ChildComments.map((c: any) => c.id),
    ["r2", "r1"],
    "higher weighted-votes reply first under top sort"
  );
  assert.equal(result.aggregateChildCommentCount, 2);
});

test("paginates replies with limit", async () => {
  await seedParentWithReplies();

  const result = await getCommentReplies({ commentId: "p1", sort: "top", limit: "1" });
  assert.equal(result.ChildComments.length, 1);
  assert.equal(result.ChildComments[0].id, "r2");
  assert.equal(result.aggregateChildCommentCount, 2, "aggregate reflects all replies, not the page");
});

test("returns an empty result when the comment has no replies", async () => {
  await run(`CREATE (:Comment { id: 'lonely', text: 'no replies', isRootComment: true, createdAt: datetime() })`);

  const result = await getCommentReplies({ commentId: "lonely" });
  assert.deepEqual(result.ChildComments, []);
  assert.equal(result.aggregateChildCommentCount, 0);
});
