// Integration test for a real .cypher query, run against a live Neo4j
// container. This exercises the exact query string the app ships
// (commentIsUpvotedByUserQuery), which unit tests cannot validate because they
// mock the driver and never run Cypher.

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Driver } from "neo4j-driver";
import { startNeo4j, stopNeo4j, resetDatabase } from "./neo4jHarness.js";
import { commentIsUpvotedByUserQuery } from "../../customResolvers/cypher/cypherQueries.js";

let driver: Driver;

// Container startup includes an image pull on first run, so allow plenty of time.
before(async () => {
  driver = await startNeo4j();
}, { timeout: 240000 });

after(async () => {
  await stopNeo4j();
});

beforeEach(async () => {
  await resetDatabase(driver);
});

const seedComment = async (
  commentId: string,
  upvoterUsernames: string[]
): Promise<void> => {
  const session = driver.session();
  try {
    await session.run("CREATE (:Comment { id: $commentId })", { commentId });
    for (const username of upvoterUsernames) {
      await session.run(
        `MATCH (c:Comment { id: $commentId })
         MERGE (u:User { username: $username })
         CREATE (u)-[:UPVOTED_COMMENT]->(c)`,
        { commentId, username }
      );
    }
  } finally {
    await session.close();
  }
};

const runQuery = async (commentId: string, username: string) => {
  const session = driver.session();
  try {
    const result = await session.run(commentIsUpvotedByUserQuery, {
      commentId,
      username,
    });
    return result.records[0].get("result") as { upvotedByUser: boolean };
  } finally {
    await session.close();
  }
};

test("reports true when the user upvoted the comment", async () => {
  await seedComment("comment-1", ["alice", "bob"]);
  const result = await runQuery("comment-1", "alice");
  assert.equal(result.upvotedByUser, true);
});

test("reports false when the user did not upvote the comment", async () => {
  await seedComment("comment-1", ["bob"]);
  const result = await runQuery("comment-1", "alice");
  assert.equal(result.upvotedByUser, false);
});

test("reports false when the comment has no upvotes", async () => {
  await seedComment("comment-1", []);
  const result = await runQuery("comment-1", "alice");
  assert.equal(result.upvotedByUser, false);
});
