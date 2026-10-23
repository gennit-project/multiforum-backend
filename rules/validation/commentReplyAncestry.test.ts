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

test("allows a comment create without a reply relationship", async () => {
  await assert.doesNotReject(validateCreateCommentReplyAncestry({
    text: "standalone",
    isRootComment: true,
  }, context()));
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

test("rejects creating a parent comment inline", async () => {
  const input = {
    ...createReply(),
    ParentComment: {
      create: { node: { text: "inline parent", isRootComment: true } },
    },
  } as unknown as CommentCreateInput;
  await assert.rejects(
    validateCreateCommentReplyAncestry(input, context()),
    /parents must already exist/
  );
});

test("rejects a parent connection that is not selected by ID", async () => {
  const input = {
    ...createReply(),
    ParentComment: {
      connect: { where: { node: { text: "not unique" } } },
    },
  } as unknown as CommentCreateInput;
  await assert.rejects(
    validateCreateCommentReplyAncestry(input, context()),
    /unique comment ID/
  );
});

test("rejects reply writes nested in another create relationship", async () => {
  const input = {
    text: "reply",
    isRootComment: false,
    CommentAuthor: {
      create: {
        node: {
          ParentComment: { connect: { where: { node: { id: "parent" } } } },
        },
      },
    },
  } as unknown as CommentCreateInput;
  await assert.rejects(
    validateCreateCommentReplyAncestry(input, context()),
    /Nested reply relationship writes are not supported/
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

test("allows updates that do not change reply relationships", async () => {
  await assert.doesNotReject(validateUpdateCommentReplyAncestry(
    { text: { set: "edited" } },
    { id: { eq: "child" } },
    context()
  ));
});

test("allows disconnecting a parent without connecting a replacement", async () => {
  const update = {
    ParentComment: { disconnect: { where: { node: { id: "parent" } } } },
  } as unknown as CommentUpdateInput;
  await assert.doesNotReject(validateUpdateCommentReplyAncestry(
    update,
    { id: { eq: "child" } },
    context()
  ));
});

test("rejects ChildComments relationship updates", async () => {
  const update = {
    ChildComments: { disconnect: { where: { node: { id: "child" } } } },
  } as unknown as CommentUpdateInput;
  await assert.rejects(
    validateUpdateCommentReplyAncestry(update, { id: { eq: "parent" } }, context()),
    /ChildComments updates are not supported/
  );
});

test("rejects connect-or-create reparenting", async () => {
  const update = {
    ParentComment: {
      connectOrCreate: {
        where: { node: { id: "parent" } },
        onCreate: { node: { text: "parent", isRootComment: true } },
      },
    },
  } as unknown as CommentUpdateInput;
  await assert.rejects(
    validateUpdateCommentReplyAncestry(update, { id: { eq: "child" } }, context()),
    /parents must already exist/
  );
});

test("rejects reply writes nested in a parent update", async () => {
  const update = {
    ParentComment: {
      update: {
        where: { node: { id: "parent" } },
        update: {
          ParentComment: { connect: { where: { node: { id: "grandparent" } } } },
        },
      },
    },
  } as unknown as CommentUpdateInput;
  await assert.rejects(
    validateUpdateCommentReplyAncestry(update, { id: { eq: "child" } }, context()),
    /Nested reply relationship writes are not supported/
  );
});

test("rejects a self-cycle during reparenting", async () => {
  const update: CommentUpdateInput = {
    ParentComment: {
      connect: { where: { node: { id: "same" } }, overwrite: true },
    },
  };
  await assert.rejects(
    validateUpdateCommentReplyAncestry(update, { id: { eq: "same" } }, context()),
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
      { id: { eq: "child" } },
      context({ currentParentIds: ["old-parent"] })
    )
  );
});

test("allows disconnect-and-connect reparenting", async () => {
  const update = {
    ParentComment: {
      disconnect: { where: { node: { id: "old-parent" } } },
      connect: { where: { node: { id: "new-parent" } } },
    },
  } as unknown as CommentUpdateInput;
  await assert.doesNotReject(validateUpdateCommentReplyAncestry(
    update,
    { id: { eq: "child" } },
    context({ currentParentIds: ["old-parent"] })
  ));
});
