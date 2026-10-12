import assert from "node:assert/strict";
import test from "node:test";
import type { Driver } from "neo4j-driver";
import type { CommentCreateInput, CommentUpdateInput } from "../../src/generated/graphql.js";
import type { GraphQLContext } from "../../types/context.js";
import {
  validateCreateCommentReplyAncestry,
  validateUpdateCommentReplyAncestry,
} from "./commentIsValid.js";
import { MAX_REPLY_DEPTH } from "../../services/replyAncestry.js";

const context = (values: Record<string, unknown> = {}): GraphQLContext => ({
  driver: {
    session: () => ({
      executeRead: async (work: (tx: { run: () => Promise<unknown> }) => Promise<unknown>) =>
        work({
          run: async () => ({
            records: [{
              get: (key: string) => ({
                parentDepth: 0,
                parentHasCycle: false,
                parentExceedsMaxDepth: false,
                ancestryHasMultipleParents: false,
                wouldCreateCycle: false,
                currentParentIds: [],
                ...values,
              })[key],
            }],
          }),
        }),
      close: async () => undefined,
    }),
  } as unknown as Driver,
  ogm: {} as GraphQLContext["ogm"],
});

const createReply = (): CommentCreateInput => ({
  text: "reply",
  isRootComment: false,
  ParentComment: {
    connect: { where: { node: { id: "parent" } } },
  },
});

test("accepts a create input connected to one valid parent", async () => {
  await assert.doesNotReject(
    validateCreateCommentReplyAncestry(createReply(), context())
  );
});

test("rejects a root comment with a parent", async () => {
  const input = createReply();
  input.isRootComment = true;
  await assert.rejects(
    validateCreateCommentReplyAncestry(input, context()),
    /root comment cannot have a reply parent/
  );
});

test("rejects nested ChildComments creation", async () => {
  const input = createReply();
  input.ChildComments = {
    create: [{ node: { text: "nested", isRootComment: false } }],
  };
  await assert.rejects(
    validateCreateCommentReplyAncestry(input, context()),
    /nested ChildComments writes are not supported/
  );
});

test("rejects a create input whose parent is at the maximum depth", async () => {
  await assert.rejects(
    validateCreateCommentReplyAncestry(
      createReply(),
      context({ parentDepth: MAX_REPLY_DEPTH })
    ),
    /more than 32 levels/
  );
});

test("rejects reparenting without a unique child ID", async () => {
  const update: CommentUpdateInput = {
    ParentComment: {
      connect: { where: { node: { id: "parent" } } },
    },
  };
  await assert.rejects(
    validateUpdateCommentReplyAncestry(update, undefined, context()),
    /target one comment by its unique ID/
  );
});

test("rejects a self-cycle during reparenting", async () => {
  const update: CommentUpdateInput = {
    ParentComment: {
      connect: { where: { node: { id: "same" } }, overwrite: true },
    },
  };
  await assert.rejects(
    validateUpdateCommentReplyAncestry(update, { id: "same" }, context()),
    /cannot reply to itself/
  );
});

test("allows explicit overwrite reparenting", async () => {
  const update: CommentUpdateInput = {
    ParentComment: {
      connect: { where: { node: { id: "new-parent" } }, overwrite: true },
    },
  };
  await assert.doesNotReject(
    validateUpdateCommentReplyAncestry(
      update,
      { id: "child" },
      context({ currentParentIds: ["old-parent"] })
    )
  );
});
