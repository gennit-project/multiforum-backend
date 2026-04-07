import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBotInvocationContext,
  collectParentCommentThread,
} from "./buildBotInvocationContext.js";

test("buildBotInvocationContext includes forum, discussion, and threaded parent context", () => {
  const result = buildBotInvocationContext({
    invocationType: "tagged-comment",
    channel: {
      uniqueName: "bad-advice",
      displayName: "Bad Advice",
      description: "Questionable guidance only.",
      rules: ["Stay in character", "No harassment"],
    },
    discussion: {
      id: "discussion-1",
      title: "How do I ruin a dinner party?",
      body: "Need ideas fast.",
    },
    comment: {
      id: "comment-3",
      text: "Try serving soup in martini glasses.",
      ParentComment: { id: "comment-2" },
      CommentAuthor: {
        displayName: "mod-bob",
        User: { username: "bob" },
      },
    },
    parentComments: [
      {
        id: "comment-1",
        text: "What should I do?",
        authorUsername: "alice",
        authorLabel: "alice",
      },
      {
        id: "comment-2",
        text: "Definitely make it weird.",
        authorUsername: "eve",
        authorLabel: "eve",
      },
    ],
  });

  assert.deepEqual(result, {
    invocationType: "tagged-comment",
    channel: {
      uniqueName: "bad-advice",
      displayName: "Bad Advice",
      description: "Questionable guidance only.",
      rules: ["Stay in character", "No harassment"],
    },
    discussion: {
      id: "discussion-1",
      title: "How do I ruin a dinner party?",
      body: "Need ideas fast.",
    },
    comment: {
      id: "comment-3",
      text: "Try serving soup in martini glasses.",
      authorUsername: "bob",
      authorLabel: "mod-bob",
      parentCommentId: "comment-2",
    },
    thread: {
      parentComments: [
        {
          id: "comment-1",
          text: "What should I do?",
          authorUsername: "alice",
          authorLabel: "alice",
        },
        {
          id: "comment-2",
          text: "Definitely make it weird.",
          authorUsername: "eve",
          authorLabel: "eve",
        },
      ],
      rootCommentId: "comment-1",
    },
  });
});

test("collectParentCommentThread walks parent comments back to the root", async () => {
  const parentById: Record<string, any> = {
    "comment-2": {
      id: "comment-2",
      text: "Definitely make it weird.",
      ParentComment: { id: "comment-1" },
      CommentAuthor: { username: "eve" },
    },
    "comment-1": {
      id: "comment-1",
      text: "What should I do?",
      ParentComment: null,
      CommentAuthor: { username: "alice" },
    },
  };

  const result = await collectParentCommentThread({
    Comment: {
      find: async ({ where }) => [parentById[where.id]],
    },
    parentCommentId: "comment-2",
  });

  assert.deepEqual(result, [
    {
      id: "comment-1",
      text: "What should I do?",
      authorUsername: "alice",
      authorLabel: "alice",
    },
    {
      id: "comment-2",
      text: "Definitely make it weird.",
      authorUsername: "eve",
      authorLabel: "eve",
    },
  ]);
});
