// Integration tests for the super-upvote ("scratchpad") resolvers against live
// Neo4j: createScratchpadEntry + undoSuperUpvote. These read context.user
// directly (no setUserDataOnContext), so the context just sets the user.

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
  // alice (actor) has upvoted comment-1; bob is the comment author / recipient.
  await run(
    `CREATE (alice:User { username: 'alice' })
     CREATE (bob:User { username: 'bob' })
     CREATE (c:Comment { id: 'comment-1', text: 'great point', isRootComment: true, createdAt: datetime() })
     CREATE (alice)-[:UPVOTED_COMMENT]->(c)`
  );
});

const asUser = (username: string) => ({
  user: { username },
  driver: env.driver,
  ogm: env.ogm,
});

const createScratchpadEntry = (args: Record<string, unknown>, username = "alice") =>
  env.resolvers.Mutation.createScratchpadEntry(null, args, asUser(username));

const undoSuperUpvote = (args: Record<string, unknown>, username = "alice") =>
  env.resolvers.Mutation.undoSuperUpvote(null, args, asUser(username));

const baseArgs = {
  recipientUsername: "bob",
  text: "Thanks for the thoughtful comment!",
  sourceType: "comment",
  sourceId: "comment-1",
};

test("createScratchpadEntry writes an entry, super-upvotes, and notifies", async () => {
  await createScratchpadEntry({ ...baseArgs });

  const entries = await run(
    `MATCH (:User { username: 'alice' })-[:WROTE_SCRATCHPAD_ENTRY]->(e:ScratchpadEntry)<-[:HAS_SCRATCHPAD_ENTRY]-(:User { username: 'bob' })
     RETURN e.text AS text, e.sourceType AS sourceType`
  );
  assert.equal(entries.length, 1, `expected one scratchpad entry, got ${entries.length}`);
  assert.equal(entries[0].sourceType, "comment");

  const superUpvote = await run(
    `MATCH (:User { username: 'alice' })-[:SUPER_UPVOTED_COMMENT]->(:Comment { id: 'comment-1' })
     RETURN count(*) AS n`
  );
  assert.equal(Number(superUpvote[0].n), 1);

  const notifications = await run(
    `MATCH (b:User { username: 'bob' })-[:HAS_NOTIFICATION]->(n:Notification)
     RETURN count(n) AS n`
  );
  assert.equal(Number(notifications[0].n), 1, "recipient should get a notification");
});

test("createScratchpadEntry throws if the actor has not upvoted the content", async () => {
  // carol exists but never upvoted comment-1
  await run(`CREATE (:User { username: 'carol' })`);
  await assert.rejects(
    createScratchpadEntry({ ...baseArgs }, "carol"),
    /must upvote the content/i
  );
});

test("createScratchpadEntry rejects writing on your own scratchpad", async () => {
  await assert.rejects(
    createScratchpadEntry({ ...baseArgs, recipientUsername: "alice" }),
    /your own scratchpad/i
  );
});

test("createScratchpadEntry throws when the recipient does not exist", async () => {
  await assert.rejects(
    createScratchpadEntry({ ...baseArgs, recipientUsername: "ghost" }),
    /Recipient user not found/i
  );
});

test("createScratchpadEntry rejects empty text", async () => {
  await assert.rejects(
    createScratchpadEntry({ ...baseArgs, text: "   " }),
    /cannot be empty/i
  );
});

test("undoSuperUpvote removes the super-upvote and deletes the scratchpad entry", async () => {
  await createScratchpadEntry({ ...baseArgs });
  await undoSuperUpvote({ sourceType: "comment", sourceId: "comment-1" });

  const superUpvote = await run(
    `MATCH (:User { username: 'alice' })-[:SUPER_UPVOTED_COMMENT]->(:Comment { id: 'comment-1' })
     RETURN count(*) AS n`
  );
  assert.equal(Number(superUpvote[0].n), 0, "super-upvote relationship should be removed");

  const entries = await run(
    `MATCH (e:ScratchpadEntry { sourceId: 'comment-1' }) RETURN count(e) AS n`
  );
  assert.equal(Number(entries[0].n), 0, "scratchpad entry should be deleted");
});

test("undoSuperUpvote throws when the user has not super-upvoted", async () => {
  await assert.rejects(
    undoSuperUpvote({ sourceType: "comment", sourceId: "comment-1" }),
    /not super upvoted/i
  );
});
