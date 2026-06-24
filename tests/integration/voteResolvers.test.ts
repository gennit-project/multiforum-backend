// Integration tests for the upvote/undo-upvote resolvers against a live Neo4j
// container. These resolvers run a real transaction: they guard against double
// voting, create/delete the UPVOTED_* relationship, adjust the target's
// weightedVotesCount, and bump the content author's karma. The existing
// voteResolvers.test.ts only exercises this with a mocked driver, so the actual
// Cypher / transaction / karma writes are unverified until now.
//
// Voters are seeded with commentKarma/discussionKarma 0 so getWeightedVoteBonus
// is 0 and each vote moves weightedVotesCount by exactly 1.

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

const upvoteComment = (commentId: string, username: string) =>
  env.resolvers.Mutation.upvoteComment(null, { commentId, username }, {});
const undoUpvoteComment = (commentId: string, username: string) =>
  env.resolvers.Mutation.undoUpvoteComment(null, { commentId, username }, {});
const upvoteDiscussionChannel = (discussionChannelId: string, username: string) =>
  env.resolvers.Mutation.upvoteDiscussionChannel(
    null,
    { discussionChannelId, username },
    {}
  );
const undoUpvoteDiscussionChannel = (discussionChannelId: string, username: string) =>
  env.resolvers.Mutation.undoUpvoteDiscussionChannel(
    null,
    { discussionChannelId, username },
    {}
  );

const scalar = (rows: any[], key: string) => {
  const v = rows[0]?.[key];
  return v?.toNumber ? v.toNumber() : v;
};

const commentVotes = (id: string) =>
  run(
    `MATCH (c:Comment { id: $id })
     OPTIONAL MATCH (c)<-[r:UPVOTED_COMMENT]-(:User)
     RETURN c.weightedVotesCount AS weight, count(r) AS upvotes`,
    { id }
  );

const userKarma = (username: string, field: string) =>
  run(`MATCH (u:User { username: $username }) RETURN u.${field} AS karma`, { username });

// --- comment upvotes ---

test("upvoteComment creates the relationship, bumps weightedVotesCount, and increments author karma", async () => {
  await run(
    `CREATE (author:User { username: 'author', commentKarma: 5, createdAt: datetime() })
     CREATE (voter:User { username: 'voter', commentKarma: 0, createdAt: datetime() })
     CREATE (c:Comment { id: 'c1', text: 'hi', isRootComment: true, weightedVotesCount: 0, createdAt: datetime() })
     CREATE (author)-[:AUTHORED_COMMENT]->(c)`
  );

  const result = await upvoteComment("c1", "voter");
  assert.ok(result, "resolver should return a result (no swallowed error)");

  const votes = await commentVotes("c1");
  assert.equal(scalar(votes, "upvotes"), 1, "one UPVOTED_COMMENT relationship");
  assert.equal(scalar(votes, "weight"), 1, "weightedVotesCount goes 0 -> 1 (bonus 0)");

  const karma = await userKarma("author", "commentKarma");
  assert.equal(scalar(karma, "karma"), 6, "author karma 5 -> 6");
});

test("upvoteComment a second time is a no-op (already upvoted)", async () => {
  await run(
    `CREATE (author:User { username: 'author', commentKarma: 5, createdAt: datetime() })
     CREATE (voter:User { username: 'voter', commentKarma: 0, createdAt: datetime() })
     CREATE (c:Comment { id: 'c1', text: 'hi', isRootComment: true, weightedVotesCount: 0, createdAt: datetime() })
     CREATE (author)-[:AUTHORED_COMMENT]->(c)`
  );

  await upvoteComment("c1", "voter");
  await upvoteComment("c1", "voter"); // guarded: throws internally, rolled back

  const votes = await commentVotes("c1");
  assert.equal(scalar(votes, "upvotes"), 1, "still only one upvote relationship");
  assert.equal(scalar(votes, "weight"), 1, "weight not double-counted");
  assert.equal(scalar(await userKarma("author", "commentKarma"), "karma"), 6, "karma not double-incremented");
});

test("undoUpvoteComment removes the relationship and reverses weight + karma", async () => {
  await run(
    `CREATE (author:User { username: 'author', commentKarma: 5, createdAt: datetime() })
     CREATE (voter:User { username: 'voter', commentKarma: 0, createdAt: datetime() })
     CREATE (c:Comment { id: 'c1', text: 'hi', isRootComment: true, weightedVotesCount: 0, createdAt: datetime() })
     CREATE (author)-[:AUTHORED_COMMENT]->(c)`
  );

  await upvoteComment("c1", "voter");
  await undoUpvoteComment("c1", "voter");

  const votes = await commentVotes("c1");
  assert.equal(scalar(votes, "upvotes"), 0, "relationship removed");
  assert.equal(scalar(votes, "weight"), 0, "weight back to 0");
  assert.equal(scalar(await userKarma("author", "commentKarma"), "karma"), 5, "author karma back to 5");
});

// --- discussion-channel upvotes ---

test("upvoteDiscussionChannel creates the relationship, bumps weight, and increments the discussion author's karma", async () => {
  await run(
    `CREATE (author:User { username: 'dauthor', discussionKarma: 3, createdAt: datetime() })
     CREATE (voter:User { username: 'voter', discussionKarma: 0, createdAt: datetime() })
     CREATE (ch:Channel { uniqueName: 'cats', createdAt: datetime() })
     CREATE (d:Discussion { id: 'd1', title: 'My Discussion', createdAt: datetime() })
     CREATE (dc:DiscussionChannel { id: 'dc1', discussionId: 'd1', channelUniqueName: 'cats', weightedVotesCount: 0, createdAt: datetime() })
     CREATE (author)-[:POSTED_DISCUSSION]->(d)
     CREATE (dc)-[:POSTED_IN_CHANNEL]->(d)
     CREATE (dc)-[:POSTED_IN_CHANNEL]->(ch)`
  );

  const result = await upvoteDiscussionChannel("dc1", "voter");
  assert.ok(result, "resolver should return a result");

  const votes = await run(
    `MATCH (dc:DiscussionChannel { id: 'dc1' })
     OPTIONAL MATCH (dc)<-[r:UPVOTED_DISCUSSION]-(:User)
     RETURN dc.weightedVotesCount AS weight, count(r) AS upvotes`
  );
  assert.equal(scalar(votes, "upvotes"), 1);
  assert.equal(scalar(votes, "weight"), 1);

  assert.equal(scalar(await userKarma("dauthor", "discussionKarma"), "karma"), 4, "discussion author karma 3 -> 4");
});

test("undoUpvoteDiscussionChannel removes the relationship and reverses weight + karma", async () => {
  await run(
    `CREATE (author:User { username: 'dauthor', discussionKarma: 3, createdAt: datetime() })
     CREATE (voter:User { username: 'voter', discussionKarma: 0, createdAt: datetime() })
     CREATE (ch:Channel { uniqueName: 'cats', createdAt: datetime() })
     CREATE (d:Discussion { id: 'd1', title: 'My Discussion', createdAt: datetime() })
     CREATE (dc:DiscussionChannel { id: 'dc1', discussionId: 'd1', channelUniqueName: 'cats', weightedVotesCount: 0, createdAt: datetime() })
     CREATE (author)-[:POSTED_DISCUSSION]->(d)
     CREATE (dc)-[:POSTED_IN_CHANNEL]->(d)
     CREATE (dc)-[:POSTED_IN_CHANNEL]->(ch)`
  );

  await upvoteDiscussionChannel("dc1", "voter");
  await undoUpvoteDiscussionChannel("dc1", "voter");

  const votes = await run(
    `MATCH (dc:DiscussionChannel { id: 'dc1' })
     OPTIONAL MATCH (dc)<-[r:UPVOTED_DISCUSSION]-(:User)
     RETURN dc.weightedVotesCount AS weight, count(r) AS upvotes`
  );
  assert.equal(scalar(votes, "upvotes"), 0);
  assert.equal(scalar(votes, "weight"), 0);
  assert.equal(scalar(await userKarma("dauthor", "discussionKarma"), "karma"), 3, "discussion author karma back to 3");
});
