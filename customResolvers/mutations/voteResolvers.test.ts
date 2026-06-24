import assert from "node:assert/strict";
import test from "node:test";
import type { Driver } from "neo4j-driver";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import upvoteCommentResolver from "./upvoteComment.js";
import undoUpvoteCommentResolver from "./undoUpvoteComment.js";
import upvoteDiscussionChannelResolver from "./upvoteDiscussionChannel.js";
import undoUpvoteDiscussionChannelResolver from "./undoUpvoteDiscussionChannel.js";
import { getWeightedVoteBonus } from "./utils.js";
import {
  createRecord,
  createTransactionDriver,
  ModelStub,
  withMutedConsoleError,
} from "../../tests/testUtils.js";

const COMMENT_AUTHOR_KARMA = 7;
const DISCUSSION_AUTHOR_KARMA = 4;
const COMMENT_UPVOTE_STARTING_WEIGHTED_COUNT = 3;
const COMMENT_UNDO_STARTING_WEIGHTED_COUNT = 5;
const DISCUSSION_UPVOTE_STARTING_WEIGHTED_COUNT = 6;
const DISCUSSION_UNDO_STARTING_WEIGHTED_COUNT = 8;
const COMMENT_VOTER = { username: "voter", commentKarma: 25 };
const DISCUSSION_VOTER = { username: "voter", discussionKarma: 25 };
const COMMENT_WEIGHTED_VOTE_BONUS = getWeightedVoteBonus(COMMENT_VOTER as any);
const COMMENT_VOTE_DELTA = 1 + COMMENT_WEIGHTED_VOTE_BONUS;
const DISCUSSION_VOTE_DELTA =
  1 + getWeightedVoteBonus(DISCUSSION_VOTER as any);

const createDriver = ({
  alreadyUpvoted,
  missingVoteRecord = false,
}: {
  alreadyUpvoted: boolean;
  missingVoteRecord?: boolean;
}) => {
  return createTransactionDriver({
    firstRunRecords: missingVoteRecord
      ? []
      : [createRecord({ upvotedByUser: alreadyUpvoted })],
  });
};

const runUpvoteComment = async ({
  alreadyUpvoted = false,
}: {
  alreadyUpvoted?: boolean;
} = {}) => {
  const { driver, calls } = createDriver({ alreadyUpvoted });
  const Comment = new ModelStub(() => [
    {
      id: "comment-1",
      CommentAuthor: { username: "author", commentKarma: COMMENT_AUTHOR_KARMA },
      weightedVotesCount: COMMENT_UPVOTE_STARTING_WEIGHTED_COUNT,
      UpvotedByUsers: [{ username: "other-user" }],
      UpvotedByUsersAggregate: { count: 1 },
    },
  ]);
  const User = new ModelStub(({ where }) =>
    where?.username === "voter"
      ? [COMMENT_VOTER]
      : [{ username: "author", commentKarma: COMMENT_AUTHOR_KARMA }]
  );
  const resolver = upvoteCommentResolver({
    Comment: Comment as any,
    User: User as any,
    driver: driver as unknown as Driver,
  });

  const result = await resolver(
    null,
    { commentId: "comment-1", username: "voter" },
    {} as unknown as GraphQLContext,
    null as unknown as GraphQLResolveInfo
  );

  return { result, calls, Comment, User };
};

const runUndoUpvoteComment = async ({
  alreadyUpvoted = true,
  missingVoteRecord = false,
}: {
  alreadyUpvoted?: boolean;
  missingVoteRecord?: boolean;
} = {}) => {
  const { driver, calls } = createDriver({ alreadyUpvoted, missingVoteRecord });
  const Comment = new ModelStub(() => [
    {
      id: "comment-1",
      CommentAuthor: { username: "author", commentKarma: COMMENT_AUTHOR_KARMA },
      weightedVotesCount: COMMENT_UNDO_STARTING_WEIGHTED_COUNT,
      UpvotedByUsers: [{ username: "voter" }, { username: "other-user" }],
      UpvotedByUsersAggregate: { count: 2 },
    },
  ]);
  const User = new ModelStub(({ where }) =>
    where?.username === "voter"
      ? [COMMENT_VOTER]
      : [{ username: "author", commentKarma: COMMENT_AUTHOR_KARMA }]
  );
  const resolver = undoUpvoteCommentResolver({
    Comment: Comment as any,
    User: User as any,
    driver: driver as unknown as Driver,
  });

  const result = await resolver(
    null,
    { commentId: "comment-1", username: "voter" },
    {} as unknown as GraphQLContext,
    null as unknown as GraphQLResolveInfo
  );

  return { result, calls, Comment, User };
};

const runUpvoteDiscussionChannel = async ({
  alreadyUpvoted = false,
}: {
  alreadyUpvoted?: boolean;
} = {}) => {
  const { driver, calls } = createDriver({ alreadyUpvoted });
  const DiscussionChannel = new ModelStub(() => [
    {
      id: "discussion-channel-1",
      Discussion: {
        Author: { username: "author", discussionKarma: DISCUSSION_AUTHOR_KARMA },
      },
      weightedVotesCount: DISCUSSION_UPVOTE_STARTING_WEIGHTED_COUNT,
      UpvotedByUsers: [],
      UpvotedByUsersAggregate: { count: 0 },
    },
  ]);
  const User = new ModelStub(({ where }) =>
    where?.username === "voter"
      ? [DISCUSSION_VOTER]
      : [{ username: "author", discussionKarma: DISCUSSION_AUTHOR_KARMA }]
  );
  const resolver = upvoteDiscussionChannelResolver({
    DiscussionChannel: DiscussionChannel as any,
    User: User as any,
    driver: driver as unknown as Driver,
  });

  const result = await resolver(
    null,
    { discussionChannelId: "discussion-channel-1", username: "voter" },
    {} as unknown as GraphQLContext,
    null as unknown as GraphQLResolveInfo
  );

  return { result, calls, DiscussionChannel, User };
};

const runUndoUpvoteDiscussionChannel = async ({
  alreadyUpvoted = true,
}: {
  alreadyUpvoted?: boolean;
} = {}) => {
  const { driver, calls } = createDriver({ alreadyUpvoted });
  const DiscussionChannel = new ModelStub(() => [
    {
      id: "discussion-channel-1",
      Discussion: {
        Author: { username: "author", discussionKarma: DISCUSSION_AUTHOR_KARMA },
      },
      weightedVotesCount: DISCUSSION_UNDO_STARTING_WEIGHTED_COUNT,
      UpvotedByUsers: [{ username: "voter" }, { username: "other-user" }],
      UpvotedByUsersAggregate: { count: 2 },
    },
  ]);
  const User = new ModelStub(({ where }) =>
    where?.username === "voter"
      ? [DISCUSSION_VOTER]
      : [{ username: "author", discussionKarma: DISCUSSION_AUTHOR_KARMA }]
  );
  const resolver = undoUpvoteDiscussionChannelResolver({
    DiscussionChannel: DiscussionChannel as any,
    User: User as any,
    driver: driver as unknown as Driver,
  });

  const result = await resolver(
    null,
    { discussionChannelId: "discussion-channel-1", username: "voter" },
    {} as unknown as GraphQLContext,
    null as unknown as GraphQLResolveInfo
  );

  return { result, calls, DiscussionChannel, User };
};

const weightedCountCases = [
  {
    name: "upvoteComment returns the new weighted count",
    runResolver: runUpvoteComment,
    expected:
      COMMENT_UPVOTE_STARTING_WEIGHTED_COUNT + COMMENT_VOTE_DELTA,
  },
  {
    name: "undoUpvoteComment returns the new weighted count",
    runResolver: runUndoUpvoteComment,
    expected:
      COMMENT_UNDO_STARTING_WEIGHTED_COUNT - COMMENT_VOTE_DELTA,
  },
  {
    name: "upvoteDiscussionChannel returns the new weighted count",
    runResolver: runUpvoteDiscussionChannel,
    expected:
      DISCUSSION_UPVOTE_STARTING_WEIGHTED_COUNT + DISCUSSION_VOTE_DELTA,
  },
  {
    name: "undoUpvoteDiscussionChannel returns the new weighted count",
    runResolver: runUndoUpvoteDiscussionChannel,
    expected:
      DISCUSSION_UNDO_STARTING_WEIGHTED_COUNT - DISCUSSION_VOTE_DELTA,
  },
];

for (const { name, runResolver, expected } of weightedCountCases) {
  test(name, async () => {
    const { result } = await runResolver();

    assert.equal(result?.weightedVotesCount, expected);
  });
}

test("upvoteComment returns the new voter connection", async () => {
  const { result } = await runUpvoteComment();

  assert.deepEqual(result?.UpvotedByUsers, [
    { username: "other-user" },
    { username: "voter" },
  ]);
});

test("upvoteComment returns the new voter aggregate count", async () => {
  const { result } = await runUpvoteComment();

  assert.equal(result?.UpvotedByUsersAggregate.count, 2);
});

test("upvoteComment increments author karma", async () => {
  const { User } = await runUpvoteComment();

  assert.deepEqual(User.updateCalls[0], {
    where: { username: "author" },
    update: { commentKarma: COMMENT_AUTHOR_KARMA + 1 },
  });
});

test("upvoteComment creates the upvote relationship", async () => {
  const { calls } = await runUpvoteComment();

  assert.equal(/UPVOTED_COMMENT/.test(calls.run[1][0]), true);
});

test("upvoteComment writes the weighted vote bonus", async () => {
  const { calls } = await runUpvoteComment();

  assert.equal(calls.run[1][1].weightedVoteBonus, COMMENT_WEIGHTED_VOTE_BONUS);
});

test("upvoteComment commits the transaction", async () => {
  const { calls } = await runUpvoteComment();

  assert.deepEqual(
    { commit: calls.commit, rollback: calls.rollback, close: calls.close },
    { commit: 1, rollback: 0, close: 1 }
  );
});

test("upvoteComment returns undefined when the user already upvoted", async () => {
  const { result } = await withMutedConsoleError(() =>
    runUpvoteComment({ alreadyUpvoted: true })
  );

  assert.equal(result, undefined);
});

test("upvoteComment skips the comment lookup when the user already upvoted", async () => {
  const { Comment } = await withMutedConsoleError(() =>
    runUpvoteComment({ alreadyUpvoted: true })
  );

  assert.equal(Comment.findCalls.length, 0);
});

test("upvoteComment rolls back when the user already upvoted", async () => {
  const { calls } = await withMutedConsoleError(() =>
    runUpvoteComment({ alreadyUpvoted: true })
  );

  assert.deepEqual(
    { commit: calls.commit, rollback: calls.rollback, close: calls.close },
    { commit: 0, rollback: 1, close: 1 }
  );
});

test("undoUpvoteComment removes the voter connection", async () => {
  const { result } = await runUndoUpvoteComment();

  assert.deepEqual(result.UpvotedByUsers, [{ username: "other-user" }]);
});

test("undoUpvoteComment returns the new voter aggregate count", async () => {
  const { result } = await runUndoUpvoteComment();

  assert.equal(result.UpvotedByUsersAggregate.count, 1);
});

test("undoUpvoteComment decrements author karma", async () => {
  const { User } = await runUndoUpvoteComment();

  assert.deepEqual(User.updateCalls[0], {
    where: { username: "author" },
    update: { commentKarma: COMMENT_AUTHOR_KARMA - 1 },
  });
});

test("undoUpvoteComment deletes the upvote relationship", async () => {
  const { calls } = await runUndoUpvoteComment();

  assert.equal(/DELETE r/.test(calls.run[1][0]), true);
});

test("undoUpvoteComment commits the transaction", async () => {
  const { calls } = await runUndoUpvoteComment();

  assert.deepEqual(
    { commit: calls.commit, rollback: calls.rollback, close: calls.close },
    { commit: 1, rollback: 0, close: 1 }
  );
});

test("undoUpvoteComment rejects when the user has not upvoted", async () => {
  await withMutedConsoleError(() =>
    assert.rejects(
      runUndoUpvoteComment({ alreadyUpvoted: false }),
      /haven't upvoted this comment yet/
    )
  );
});

test("undoUpvoteComment rejects when the vote lookup has no record", async () => {
  await withMutedConsoleError(() =>
    assert.rejects(
      runUndoUpvoteComment({ alreadyUpvoted: false, missingVoteRecord: true }),
      /Comment not found/
    )
  );
});

test("upvoteDiscussionChannel returns the new voter connection", async () => {
  const { result } = await runUpvoteDiscussionChannel();

  assert.deepEqual(result?.UpvotedByUsers, [{ username: "voter" }]);
});

test("upvoteDiscussionChannel returns the new voter aggregate count", async () => {
  const { result } = await runUpvoteDiscussionChannel();

  assert.equal(result?.UpvotedByUsersAggregate.count, 1);
});

test("upvoteDiscussionChannel increments author karma", async () => {
  const { User } = await runUpvoteDiscussionChannel();

  assert.deepEqual(User.updateCalls[0], {
    where: { username: "author" },
    update: { discussionKarma: DISCUSSION_AUTHOR_KARMA + 1 },
  });
});

test("upvoteDiscussionChannel creates the upvote relationship", async () => {
  const { calls } = await runUpvoteDiscussionChannel();

  assert.equal(/UPVOTED_DISCUSSION/.test(calls.run[1][0]), true);
});

test("upvoteDiscussionChannel commits the transaction", async () => {
  const { calls } = await runUpvoteDiscussionChannel();

  assert.deepEqual(
    { commit: calls.commit, rollback: calls.rollback, close: calls.close },
    { commit: 1, rollback: 0, close: 1 }
  );
});

test("upvoteDiscussionChannel returns undefined when the user already upvoted", async () => {
  const { result } = await withMutedConsoleError(() =>
    runUpvoteDiscussionChannel({
      alreadyUpvoted: true,
    })
  );

  assert.equal(result, undefined);
});

test("upvoteDiscussionChannel skips the discussion lookup when the user already upvoted", async () => {
  const { DiscussionChannel } = await withMutedConsoleError(() =>
    runUpvoteDiscussionChannel({
      alreadyUpvoted: true,
    })
  );

  assert.equal(DiscussionChannel.findCalls.length, 0);
});

test("upvoteDiscussionChannel rolls back when the user already upvoted", async () => {
  const { calls } = await withMutedConsoleError(() =>
    runUpvoteDiscussionChannel({
      alreadyUpvoted: true,
    })
  );

  assert.deepEqual(
    { commit: calls.commit, rollback: calls.rollback, close: calls.close },
    { commit: 0, rollback: 1, close: 1 }
  );
});

test("undoUpvoteDiscussionChannel removes the voter connection", async () => {
  const { result } = await runUndoUpvoteDiscussionChannel();

  assert.deepEqual(result?.UpvotedByUsers, [{ username: "other-user" }]);
});

test("undoUpvoteDiscussionChannel returns the new voter aggregate count", async () => {
  const { result } = await runUndoUpvoteDiscussionChannel();

  assert.equal(result?.UpvotedByUsersAggregate.count, 1);
});

test("undoUpvoteDiscussionChannel decrements author karma", async () => {
  const { User } = await runUndoUpvoteDiscussionChannel();

  assert.deepEqual(User.updateCalls[0], {
    where: { username: "author" },
    update: { discussionKarma: DISCUSSION_AUTHOR_KARMA - 1 },
  });
});

test("undoUpvoteDiscussionChannel deletes the upvote relationship", async () => {
  const { calls } = await runUndoUpvoteDiscussionChannel();

  assert.equal(/UPVOTED_DISCUSSION/.test(calls.run[1][0]), true);
});

test("undoUpvoteDiscussionChannel commits the transaction", async () => {
  const { calls } = await runUndoUpvoteDiscussionChannel();

  assert.deepEqual(
    { commit: calls.commit, rollback: calls.rollback, close: calls.close },
    { commit: 1, rollback: 0, close: 1 }
  );
});

test("undoUpvoteDiscussionChannel returns undefined when the user has not upvoted", async () => {
  const { result } = await withMutedConsoleError(() =>
    runUndoUpvoteDiscussionChannel({
      alreadyUpvoted: false,
    })
  );

  assert.equal(result, undefined);
});

test("undoUpvoteDiscussionChannel skips the discussion lookup when the user has not upvoted", async () => {
  const { DiscussionChannel } = await withMutedConsoleError(() =>
    runUndoUpvoteDiscussionChannel({
      alreadyUpvoted: false,
    })
  );

  assert.equal(DiscussionChannel.findCalls.length, 0);
});

test("undoUpvoteDiscussionChannel rolls back when the user has not upvoted", async () => {
  const { calls } = await withMutedConsoleError(() =>
    runUndoUpvoteDiscussionChannel({
      alreadyUpvoted: false,
    })
  );

  assert.deepEqual(
    { commit: calls.commit, rollback: calls.rollback, close: calls.close },
    { commit: 0, rollback: 1, close: 1 }
  );
});
