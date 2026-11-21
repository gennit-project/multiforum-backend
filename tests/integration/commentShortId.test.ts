// Integration coverage for the comment shortId URL handle, so comment
// permalinks read /forums/cats/.../comments/4f3a9b2e1c7d instead of a full UUID.
// Exercises the shared Cypher generation expression (via the real
// ownCommentConnections main-path write), the Comment.shortId constraint, the
// shortId->id lookup, and the startup backfill against a live Neo4j.
import assert from "node:assert/strict";
import { before, after, beforeEach, test } from "node:test";
import type { Driver } from "neo4j-driver";
import { ownCommentConnections } from "../../services/persistence/commentCreationWrite.js";
import { backfillCommentShortIds } from "../../services/commentShortIdBackfill.js";
import {
  resolveCommentIdByShortId,
  COMMENT_SHORT_ID_CYPHER,
} from "../../services/commentShortId.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";

// Create only the constraint under test (not the whole core set), so this file
// never leaves pollinating constraints like Tag.text that other tests sharing a
// reused Testcontainers container do not expect.
const CONSTRAINT =
  "CREATE CONSTRAINT comment_shortid_unique IF NOT EXISTS FOR (c:Comment) REQUIRE c.shortId IS UNIQUE";

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

const emptyTargets = {
  authorUsername: null,
  authorModProfileName: null,
  discussionChannelId: null,
  eventId: null,
  channelUniqueName: null,
  parentCommentId: null,
  feedbackCommentId: null,
  feedbackDiscussionId: null,
  feedbackEventId: null,
  upvoterUsernames: [] as string[],
  subscriberUsernames: [] as string[],
};

const shortIdOf = async (commentId: string): Promise<string | null> => {
  const result = await driver.executeQuery(
    "MATCH (c:Comment {id: $id}) RETURN c.shortId AS shortId",
    { id: commentId }
  );
  return (result.records[0]?.get("shortId") as string | null) ?? null;
};

const SHORT_ID = /^[0-9a-f]{12}$/;

test("the generation expression yields a 12-hex-char id", async () => {
  const result = await driver.executeQuery(
    `RETURN ${COMMENT_SHORT_ID_CYPHER} AS shortId`
  );
  assert.match(result.records[0].get("shortId") as string, SHORT_ID);
});

test("the owned-connections write assigns a shortId to a new comment", async () => {
  await driver.executeQuery(
    "CREATE (:Comment {id:'c1', text:'hi', createdAt: datetime()})"
  );
  await ownCommentConnections(driver, "c1", emptyTargets);
  const shortId = await shortIdOf("c1");
  assert.ok(shortId);
  assert.match(shortId, SHORT_ID);
});

test("an existing shortId is preserved, not regenerated", async () => {
  await driver.executeQuery(
    "CREATE (:Comment {id:'c1', shortId:'abc123abc123', text:'hi', createdAt: datetime()})"
  );
  await ownCommentConnections(driver, "c1", emptyTargets);
  assert.equal(await shortIdOf("c1"), "abc123abc123");
});

test("Comment.shortId is unique", async () => {
  await driver.executeQuery(CONSTRAINT);
  await driver.executeQuery(
    "CREATE (:Comment {id:'c1', shortId:'deadbeef0001', text:'a', createdAt: datetime()})"
  );
  await assert.rejects(
    driver.executeQuery(
      "CREATE (:Comment {id:'c2', shortId:'deadbeef0001', text:'b', createdAt: datetime()})"
    ),
    /already exists|ConstraintValidationFailed|equivalent value/i
  );
});

test("resolveCommentIdByShortId maps a shortId back to its comment id", async () => {
  await driver.executeQuery(
    "CREATE (:Comment {id:'c1', shortId:'aaaa1111bbbb', text:'a', createdAt: datetime()})"
  );
  const session = driver.session();
  try {
    assert.equal(await resolveCommentIdByShortId(session, "aaaa1111bbbb"), "c1");
    assert.equal(await resolveCommentIdByShortId(session, "nope00000000"), null);
  } finally {
    await session.close();
  }
});

test("backfill assigns unique shortIds to comments lacking one and is idempotent", async () => {
  await driver.executeQuery(
    "CREATE (:Comment {id:'c1', text:'a', createdAt: datetime()}), " +
      "(:Comment {id:'c2', text:'b', createdAt: datetime()}), " +
      "(:Comment {id:'c3', shortId:'keepkeepkeep', text:'c', createdAt: datetime()})"
  );

  const result = await backfillCommentShortIds(driver);
  assert.equal(result.commentsAssigned, 2); // c3 already had one

  const s1 = await shortIdOf("c1");
  const s2 = await shortIdOf("c2");
  assert.ok(s1 && s2);
  assert.match(s1, SHORT_ID);
  assert.match(s2, SHORT_ID);
  assert.notEqual(s1, s2);
  assert.equal(await shortIdOf("c3"), "keepkeepkeep");

  // Running it again is a no-op.
  const again = await backfillCommentShortIds(driver);
  assert.equal(again.commentsAssigned, 0);
});
