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
     CREATE (c:Comment { id: 'comment-1', text: 'great point', isRootComment: true, weightedVotesCount: 0, createdAt: datetime() })
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

const updateScratchpadEntryVisibility = (
  args: Record<string, unknown>,
  username = "bob"
) =>
  env.resolvers.Mutation.updateScratchpadEntryVisibility(null, args, asUser(username));

// Seed a discussion that alice has already upvoted, so she can super upvote it.
// bob is the discussion author / recipient.
const seedUpvotedDiscussion = () =>
  run(
    `MATCH (alice:User { username: 'alice' })
     CREATE (d:Discussion { id: 'discussion-1', title: 'Great idea', createdAt: datetime() })
     CREATE (dc:DiscussionChannel { id: 'dc-1', discussionId: 'discussion-1', channelUniqueName: 'cats', weightedVotesCount: 0, createdAt: datetime() })
     CREATE (alice)-[:UPVOTED_DISCUSSION]->(dc)`
  );

// Read the current weightedVotesCount (the visibility/ranking signal) for a
// Comment or DiscussionChannel.
const weightOf = async (label: "Comment" | "DiscussionChannel", id: string) => {
  const rows = await run(
    `MATCH (n:${label} { id: $id }) RETURN n.weightedVotesCount AS weight`,
    { id }
  );
  return Number(rows[0]?.weight);
};

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

  // The super upvote makes the comment more visible: weightedVotesCount 0 -> 1.
  assert.equal(await weightOf("Comment", "comment-1"), 1, "comment weight 0 -> 1");

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

  // Undoing the super upvote reverses the visibility bump: weight 1 -> 0.
  assert.equal(await weightOf("Comment", "comment-1"), 0, "comment weight back to 0");
});

test("super upvoting a discussion creates the relationship and makes it more visible", async () => {
  await seedUpvotedDiscussion();

  await createScratchpadEntry({
    recipientUsername: "bob",
    text: "Loved this discussion!",
    sourceType: "discussion",
    sourceId: "dc-1",
    sourceChannelUniqueName: "cats",
  });

  const superUpvote = await run(
    `MATCH (:User { username: 'alice' })-[:SUPER_UPVOTED_DISCUSSION]->(:DiscussionChannel { id: 'dc-1' })
     RETURN count(*) AS n`
  );
  assert.equal(Number(superUpvote[0].n), 1, "SUPER_UPVOTED_DISCUSSION relationship created");

  // The super upvote makes the discussion more visible: weightedVotesCount 0 -> 1.
  assert.equal(await weightOf("DiscussionChannel", "dc-1"), 1, "discussion weight 0 -> 1");
});

test("undoSuperUpvote on a discussion removes the relationship, deletes the entry, and reverses the weight", async () => {
  await seedUpvotedDiscussion();
  await createScratchpadEntry({
    recipientUsername: "bob",
    text: "Loved this discussion!",
    sourceType: "discussion",
    sourceId: "dc-1",
    sourceChannelUniqueName: "cats",
  });

  await undoSuperUpvote({ sourceType: "discussion", sourceId: "dc-1" });

  const superUpvote = await run(
    `MATCH (:User { username: 'alice' })-[:SUPER_UPVOTED_DISCUSSION]->(:DiscussionChannel { id: 'dc-1' })
     RETURN count(*) AS n`
  );
  assert.equal(Number(superUpvote[0].n), 0, "super-upvote relationship should be removed");

  const entries = await run(
    `MATCH (e:ScratchpadEntry { sourceId: 'dc-1' }) RETURN count(e) AS n`
  );
  assert.equal(Number(entries[0].n), 0, "scratchpad entry should be deleted");

  assert.equal(await weightOf("DiscussionChannel", "dc-1"), 0, "discussion weight back to 0");
});

test("undoSuperUpvote throws when the user has not super-upvoted", async () => {
  await assert.rejects(
    undoSuperUpvote({ sourceType: "comment", sourceId: "comment-1" }),
    /not super upvoted/i
  );
});

test("the scratchpad notification is linked to the entry so the recipient can act on it", async () => {
  await createScratchpadEntry({ ...baseArgs });

  const linked = await run(
    `MATCH (:User { username: 'bob' })-[:HAS_NOTIFICATION]->(n:Notification)-[:NOTIFICATION_FOR_SCRATCHPAD_ENTRY]->(e:ScratchpadEntry)
     RETURN n.notificationType AS type, n.read AS read, e.sourceId AS sourceId`
  );

  assert.equal(linked.length, 1, "notification should link to exactly one scratchpad entry");
  assert.equal(linked[0].type, "scratchpad");
  assert.equal(linked[0].read, false, "new notification should be unread");
  assert.equal(linked[0].sourceId, "comment-1");
});

test("the scratchpad notification for a discussion links to the post", async () => {
  await seedUpvotedDiscussion();

  await createScratchpadEntry({
    recipientUsername: "bob",
    text: "Loved this discussion!",
    sourceType: "discussion",
    sourceId: "dc-1",
    sourceChannelUniqueName: "cats",
  });

  const notifications = await run(
    `MATCH (:User { username: 'bob' })-[:HAS_NOTIFICATION]->(n:Notification)
     RETURN n.text AS text`
  );

  assert.equal(notifications.length, 1);
  assert.match(
    notifications[0].text,
    /\/forums\/cats\/discussions\/discussion-1/,
    "notification should contain a working link to the post"
  );
});

test("createScratchpadEntry records the discussionId so the Kudos card can link to the post", async () => {
  await seedUpvotedDiscussion();

  await createScratchpadEntry({
    recipientUsername: "bob",
    text: "Loved this discussion!",
    sourceType: "discussion",
    sourceId: "dc-1",
    sourceChannelUniqueName: "cats",
  });

  const entries = await run(
    `MATCH (e:ScratchpadEntry { sourceId: 'dc-1' })
     RETURN e.discussionId AS discussionId, e.sourceChannelUniqueName AS channel`
  );

  assert.equal(entries.length, 1);
  // sourceId is the DiscussionChannel id; discussionId is the Discussion id used
  // to build the route, so they must differ and discussionId must be resolved.
  assert.equal(entries[0].discussionId, "discussion-1");
  assert.equal(entries[0].channel, "cats");
});

test("updateScratchpadEntryVisibility lets the recipient show a note on their profile", async () => {
  const created = await createScratchpadEntry({ ...baseArgs });

  // Entry starts private (pending).
  const before = await run(
    `MATCH (e:ScratchpadEntry { id: $id }) RETURN e.isPublic AS isPublic`,
    { id: created.id }
  );
  assert.equal(before[0].isPublic, false);

  // The recipient (bob) makes it public ("show on profile").
  await updateScratchpadEntryVisibility(
    { scratchpadEntryId: created.id, isPublic: true },
    "bob"
  );

  const after = await run(
    `MATCH (e:ScratchpadEntry { id: $id }) RETURN e.isPublic AS isPublic`,
    { id: created.id }
  );
  assert.equal(after[0].isPublic, true, "entry should be public after show-on-profile");
});

test("updateScratchpadEntryVisibility rejects anyone other than the recipient", async () => {
  const created = await createScratchpadEntry({ ...baseArgs });

  // alice is the author, not the recipient, so she cannot publish it.
  await assert.rejects(
    updateScratchpadEntryVisibility(
      { scratchpadEntryId: created.id, isPublic: true },
      "alice"
    ),
    /only the recipient/i
  );
});
