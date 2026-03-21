import test from "node:test";
import assert from "node:assert/strict";
import { populateCommentSubscriptionStatus } from "./commentSubscriptionStatus.js";

test("populateCommentSubscriptionStatus defaults to an empty array when logged out", async () => {
  const session = {
    async run() {
      throw new Error("session.run should not be called");
    },
  };

  const comments = await populateCommentSubscriptionStatus({
    comments: [{ id: "comment-1", text: "Hello" }],
    loggedInUsername: null,
    session,
  });

  assert.deepEqual(comments, [
    {
      id: "comment-1",
      text: "Hello",
      SubscribedToNotifications: [],
    },
  ]);
});

test("populateCommentSubscriptionStatus marks only comments watched by the current user", async () => {
  const calls: Array<{ query: string; params: Record<string, unknown> }> = [];
  const session = {
    async run(query: string, params: Record<string, unknown>) {
      calls.push({ query, params });

      return {
        records: [
          {
            get(key: string) {
              assert.equal(key, "subscribedCommentIds");
              return ["comment-2"];
            },
          },
        ],
      };
    },
  };

  const comments = await populateCommentSubscriptionStatus({
    comments: [
      { id: "comment-1", text: "One" },
      { id: "comment-2", text: "Two" },
    ],
    loggedInUsername: "cluse",
    session,
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.params, {
    loggedInUsername: "cluse",
    commentIds: ["comment-1", "comment-2"],
  });
  assert.deepEqual(comments, [
    {
      id: "comment-1",
      text: "One",
      SubscribedToNotifications: [],
    },
    {
      id: "comment-2",
      text: "Two",
      SubscribedToNotifications: [{ username: "cluse" }],
    },
  ]);
});
