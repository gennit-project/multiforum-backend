import { rule } from "graphql-shield";
import { GraphQLError, type GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import {
  CommentCreateInput,
  CommentUpdateInput,
  CommentWhere,
} from "../../src/generated/graphql.js";
import { MAX_CHARS_IN_COMMENT_TEXT } from "./constants.js";
import { logger } from "../../logger.js";
import {
  assertReplyRelationship,
  REPLY_ANCESTRY_ERROR_CODE,
} from "../../services/replyAncestry.js";
import { resolveContentFeaturePolicyRepository } from "../../services/persistence/contentFeaturePolicyRepository.js";

type CommentTextValidationInput = {
  text: string;
  modProfileName?: string;
  username?: string;
  editMode?: boolean;
}

const validateCommentInput = (input: CommentTextValidationInput): true | string => {
  const { text, modProfileName, username, editMode } = input;
  if (!editMode && (!username && !modProfileName)) {
    return "Comment author is required.";
  }
  if (!text) {
    return "Comment text is required.";
  }

  if (text.length > MAX_CHARS_IN_COMMENT_TEXT) {
    return `The comment text cannot exceed ${MAX_CHARS_IN_COMMENT_TEXT} characters.`;
  }
  logger.info('comment is valid')

  return true;
};

export const validateCreateCommentInput = (
  createCommentInput: CommentCreateInput
): true | string => {
  const hasChannelConnection =
    !!createCommentInput.Channel ||
    !!createCommentInput.DiscussionChannel ||
    !!createCommentInput.Event;
  if (!hasChannelConnection) {
    return "Comment must be attached to a channel.";
  }
  // v7 dropped the nested to-one connect from the generated types; the author
  // identity the flow carries for validation is read through a loose view.
  const view = createCommentInput as Record<string, any>;
  return validateCommentInput({
    text: createCommentInput.text || "",
    modProfileName:
      view?.CommentAuthor?.ModerationProfile?.connect?.where?.node?.displayName || "",
    username:
      view?.CommentAuthor?.User?.connect?.where?.node?.username || "",
    editMode: false,
  });
};

type CreateCommentInput = { input: CommentCreateInput[] };

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;

const hasEntries = (value: unknown): boolean =>
  Array.isArray(value)
    ? value.some(hasEntries)
    : !!asRecord(value) && Object.keys(value as UnknownRecord).length > 0;

const findNestedReplyField = (value: unknown, path = "input"): string | null => {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findNestedReplyField(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  const record = asRecord(value);
  if (!record) return null;
  for (const [key, child] of Object.entries(record)) {
    const childPath = `${path}.${key}`;
    if (key === "ParentComment" || key === "ChildComments") return childPath;
    const found = findNestedReplyField(child, childPath);
    if (found) return found;
  }
  return null;
};

const replyInputError = (message: string, path?: string): GraphQLError =>
  new GraphQLError(message, {
    extensions: {
      code: REPLY_ANCESTRY_ERROR_CODE,
      ...(path ? { path } : {}),
    },
  });

const connectedParentId = (parentInput: unknown): string | null => {
  const parent = asRecord(parentInput);
  const connect = asRecord(parent?.connect);
  const where = asRecord(connect?.where);
  const node = asRecord(where?.node);
  return typeof node?.id === "string" && node.id ? node.id : null;
};

export const validateCreateCommentReplyAncestry = async (
  input: CommentCreateInput,
  ctx: GraphQLContext
): Promise<void> => {
  if (hasEntries(input.ChildComments)) {
    throw replyInputError(
      "Create replies through ParentComment; nested ChildComments writes are not supported.",
      "input.ChildComments"
    );
  }

  const { ParentComment, ChildComments: _childComments, ...otherInput } = input;
  const nestedReplyField = findNestedReplyField(otherInput);
  if (nestedReplyField) {
    throw replyInputError(
      "Nested reply relationship writes are not supported.",
      nestedReplyField
    );
  }

  if (!hasEntries(ParentComment)) return;
  const parent = asRecord(ParentComment);
  if (hasEntries(parent?.create) || hasEntries(parent?.connectOrCreate)) {
    throw replyInputError(
      "Reply parents must already exist and be connected by ID.",
      "input.ParentComment"
    );
  }
  const nestedParentWrite = findNestedReplyField(asRecord(parent?.connect)?.connect);
  if (nestedParentWrite) {
    throw replyInputError(
      "Nested reply relationship writes are not supported.",
      `input.ParentComment.connect.connect.${nestedParentWrite}`
    );
  }
  const parentCommentId = connectedParentId(ParentComment);
  if (!parentCommentId) {
    throw replyInputError(
      "Reply parents must be connected by a unique comment ID.",
      "input.ParentComment.connect.where.node.id"
    );
  }
  if (input.isRootComment) {
    throw replyInputError("A root comment cannot have a reply parent.");
  }
  await assertReplyRelationship({
    driver: ctx.driver,
    parentCommentId,
  });
};

export const validateUpdateCommentReplyAncestry = async (
  update: CommentUpdateInput,
  where: CommentWhere | undefined,
  ctx: GraphQLContext
): Promise<void> => {
  if (hasEntries(update.ChildComments)) {
    throw replyInputError(
      "Reparent comments through ParentComment; ChildComments updates are not supported.",
      "update.ChildComments"
    );
  }

  const { ParentComment, ChildComments: _childComments, ...otherUpdate } = update as Record<string, any>;
  const nestedReplyField = findNestedReplyField(otherUpdate, "update");
  if (nestedReplyField) {
    throw replyInputError(
      "Nested reply relationship writes are not supported.",
      nestedReplyField
    );
  }
  if (!hasEntries(ParentComment)) return;

  const parent = asRecord(ParentComment);
  if (hasEntries(parent?.create) || hasEntries(parent?.connectOrCreate)) {
    throw replyInputError(
      "Reply parents must already exist and be connected by ID.",
      "update.ParentComment"
    );
  }
  for (const key of ["update", "delete"] as const) {
    const nested = findNestedReplyField(parent?.[key], `update.ParentComment.${key}`);
    if (nested) {
      throw replyInputError("Nested reply relationship writes are not supported.", nested);
    }
  }

  const connect = asRecord(parent?.connect);
  if (!hasEntries(connect)) return;
  const nestedConnect = findNestedReplyField(connect?.connect, "update.ParentComment.connect.connect");
  if (nestedConnect) {
    throw replyInputError("Nested reply relationship writes are not supported.", nestedConnect);
  }
  const parentCommentId = connectedParentId(ParentComment);
  if (!parentCommentId) {
    throw replyInputError(
      "Reply parents must be connected by a unique comment ID.",
      "update.ParentComment.connect.where.node.id"
    );
  }
  const childCommentId = typeof where?.id?.eq === "string" ? where.id.eq : null;
  if (!childCommentId) {
    throw replyInputError(
      "Reparenting must target one comment by its unique ID.",
      "where.id"
    );
  }
  await assertReplyRelationship({
    driver: ctx.driver,
    parentCommentId,
    childCommentId,
    allowParentReplacement:
      connect?.overwrite === true || hasEntries(parent?.disconnect),
  });
};

export const validateFeedbackEnabled = async (
  createCommentInput: CommentCreateInput,
  ctx: GraphQLContext
): Promise<true | string> => {
  const isFeedbackComment = !!(
    createCommentInput.GivesFeedbackOnEvent ||
    createCommentInput.GivesFeedbackOnDiscussion ||
    createCommentInput.GivesFeedbackOnComment
  );

  if (!isFeedbackComment) {
    return true;
  }

  const channelName =
    (createCommentInput as Record<string, any>).Channel?.connect?.where?.node?.uniqueName;
  if (!channelName) {
    return "Comment must be connected to a Channel.";
  }

  const channel = await resolveContentFeaturePolicyRepository(
    ctx
  ).findChannelPolicy(channelName);
  if (!channel.found) {
    return `Channel '${channelName}' not found.`;
  }

  if (channel.feedbackEnabled === false) {
    return `Feedback is disabled in channel '${channelName}'.`;
  }

  return true;
};

export const createCommentInputIsValid = rule({ cache: "contextual" })(
  async (parent: unknown, args: CreateCommentInput, ctx: GraphQLContext, info: GraphQLResolveInfo) => {
    if (!args.input || !args.input[0] || !args.input[0]) {
      return "Missing or empty input in args.";
    }
    for (const createCommentInput of args.input) {
      logger.info('validating comment input')
      logger.info('arguments passed to validate comment input ', {
        text: createCommentInput.text || "",
        modProfileName: (createCommentInput as Record<string, any>)?.CommentAuthor?.ModerationProfile?.connect?.where?.node?.displayName || "",
        username: (createCommentInput as Record<string, any>)?.CommentAuthor?.User?.connect?.where?.node?.username || "",
        editMode: false
      })
      const validation = validateCreateCommentInput(createCommentInput);
      if (validation !== true) {
        return validation;
      }
      await validateCreateCommentReplyAncestry(createCommentInput, ctx);
      const feedbackValidation = await validateFeedbackEnabled(createCommentInput, ctx);
      if (feedbackValidation !== true) return feedbackValidation;
    }
    return true;
  }
);

type UpdateCommentInput = { update: CommentUpdateInput; where?: CommentWhere };
export const updateCommentInputIsValid = rule({ cache: "contextual" })(
  async (parent: unknown, args: UpdateCommentInput, ctx: GraphQLContext, info: GraphQLResolveInfo) => {
    if (!args.update) {
      return "Missing update input in args.";
    }
    const validation = validateCommentInput({
      text: args.update?.text?.set || "",
      modProfileName: (args.update as Record<string, any>)?.CommentAuthor?.ModerationProfile?.connect?.where?.node?.displayName || "",
      username: (args.update as Record<string, any>)?.CommentAuthor?.User?.connect?.where?.node?.username || "",
      editMode: true
    });
    if (validation !== true) return validation;
    await validateUpdateCommentReplyAncestry(args.update, args.where, ctx);
    return true;
  }
);
