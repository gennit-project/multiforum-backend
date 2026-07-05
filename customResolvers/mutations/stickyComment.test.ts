import * as assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphQLResolveInfo } from "graphql";
import { stickyComment, unstickyComment } from "./stickyComment.js";
import type { CommentModel } from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";

type CommentFixture = {
  id: string;
  isRootComment?: boolean;
  isFeedbackComment?: boolean;
  deleted?: boolean;
  archived?: boolean;
  isSticky?: boolean;
};

const createCommentModel = (comment: CommentFixture) => {
  const calls: Array<Record<string, unknown>> = [];
  const model = {
    find: async () => [comment],
    update: async (input: Record<string, unknown>) => {
      calls.push(input);
      return {
        comments: [
          {
            id: comment.id,
            ...(input.update as Record<string, unknown>),
          },
        ],
      };
    },
  };

  return {
    model: model as unknown as CommentModel,
    calls,
  };
};

const createContext = (username = "mod-user") =>
  ({
    user: {
      username,
      email: `${username}@example.com`,
      email_verified: true,
      data: null,
    },
  }) as unknown as GraphQLContext;

const resolveInfo = {} as GraphQLResolveInfo;

test("stickyComment records sticky metadata", async () => {
  const { model, calls } = createCommentModel({
    id: "comment-1",
    isRootComment: true,
    isSticky: false,
  });
  const resolver = stickyComment({ Comment: model });

  await resolver(null, { commentId: "comment-1" }, createContext("alice"), resolveInfo);

  assert.equal((calls[0].update as { stickyByUsername: string }).stickyByUsername, "alice");
});

test("unstickyComment clears sticky metadata", async () => {
  const { model, calls } = createCommentModel({
    id: "comment-1",
    isRootComment: true,
    isSticky: true,
  });
  const resolver = unstickyComment({ Comment: model });

  await resolver(null, { commentId: "comment-1" }, createContext(), resolveInfo);

  assert.deepEqual(calls[0].update, {
    isSticky: false,
    stickyAt: null,
    stickyByUsername: null,
  });
});

test("stickyComment rejects child comments", async () => {
  const { model } = createCommentModel({
    id: "comment-1",
    isRootComment: false,
  });
  const resolver = stickyComment({ Comment: model });

  await assert.rejects(
    resolver(null, { commentId: "comment-1" }, createContext(), resolveInfo),
    /Only root comments can be stickied/
  );
});

test("stickyComment rejects feedback comments", async () => {
  const { model } = createCommentModel({
    id: "comment-1",
    isRootComment: true,
    isFeedbackComment: true,
  });
  const resolver = stickyComment({ Comment: model });

  await assert.rejects(
    resolver(null, { commentId: "comment-1" }, createContext(), resolveInfo),
    /Feedback comments cannot be stickied/
  );
});

test("stickyComment rejects archived comments", async () => {
  const { model } = createCommentModel({
    id: "comment-1",
    isRootComment: true,
    archived: true,
  });
  const resolver = stickyComment({ Comment: model });

  await assert.rejects(
    resolver(null, { commentId: "comment-1" }, createContext(), resolveInfo),
    /Deleted or archived comments cannot be stickied/
  );
});
