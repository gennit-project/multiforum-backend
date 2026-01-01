import { rule } from "graphql-shield";
import { CommentCreateInput, CommentUpdateInput } from "../../src/generated/graphql.js";
import { MAX_CHARS_IN_COMMENT_TEXT } from "./constants.js";

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
  console.log('comment is valid')

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
  return validateCommentInput({
    text: createCommentInput.text || "",
    modProfileName:
      createCommentInput?.CommentAuthor?.ModerationProfile?.connect?.where?.node
        ?.displayName || "",
    username:
      createCommentInput?.CommentAuthor?.User?.connect?.where?.node?.username ||
      "",
    editMode: false,
  });
};

type CreateCommentInput = { input: CommentCreateInput[] };

export const createCommentInputIsValid = rule({ cache: "contextual" })(
  async (parent: any, args: CreateCommentInput, ctx: any, info: any) => {
    if (!args.input || !args.input[0] || !args.input[0]) {
      return "Missing or empty input in args.";
    }
    const createCommentInput: CommentCreateInput = args.input[0]
    console.log('validating comment input')
    console.log('arguments passed to validate comment input ', {
      text: createCommentInput.text || "",
      modProfileName: createCommentInput?.CommentAuthor?.ModerationProfile?.connect?.where?.node?.displayName || "",
      username: createCommentInput?.CommentAuthor?.User?.connect?.where?.node?.username || "",
      editMode: false
    })
    return validateCreateCommentInput(createCommentInput);
  }
);

type UpdateCommentInput = { update: CommentUpdateInput };
export const updateCommentInputIsValid = rule({ cache: "contextual" })(
  async (parent: any, args: UpdateCommentInput, ctx: any, info: any) => {
    if (!args.update) {
      return "Missing update input in args.";
    }
    return validateCommentInput({
      text: args.update?.text || "",
      modProfileName: args.update?.CommentAuthor?.ModerationProfile?.connect?.where?.node?.displayName || "",
      username: args.update?.CommentAuthor?.User?.connect?.where?.node?.username || "",
      editMode: true
    });
  }
);
