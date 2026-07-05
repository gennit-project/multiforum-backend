import { GraphQLError } from "graphql";
import type { GraphQLResolveInfo } from "graphql";
import type { CommentModel } from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";

type Args = {
  commentId: string;
};

type CommentLookup = {
  id?: string | null;
  isRootComment?: boolean | null;
  isFeedbackComment?: boolean | null;
  deleted?: boolean | null;
  archived?: boolean | null;
  isSticky?: boolean | null;
};

type StickyCommentUpdate = {
  isSticky?: boolean;
  stickyAt?: string | null;
  stickyByUsername?: string | null;
};

type Input = {
  Comment: CommentModel;
};

const commentSelectionSet = `{
  id
  isRootComment
  isFeedbackComment
  deleted
  archived
  isSticky
}`;

const returnedCommentSelectionSet = `{
  comments {
    id
    isSticky
    stickyAt
    stickyByUsername
  }
}`;

const getComment = async (Comment: CommentModel, commentId: string) => {
  const comments = (await Comment.find({
    where: { id: commentId },
    selectionSet: commentSelectionSet,
  })) as CommentLookup[];

  const comment = comments[0];

  if (!comment) {
    throw new GraphQLError("Comment not found.");
  }

  if (comment.isRootComment !== true) {
    throw new GraphQLError("Only root comments can be stickied.");
  }

  if (comment.isFeedbackComment === true) {
    throw new GraphQLError("Feedback comments cannot be stickied.");
  }

  if (comment.deleted === true || comment.archived === true) {
    throw new GraphQLError("Deleted or archived comments cannot be stickied.");
  }

  return comment;
};

const updateComment = async ({
  Comment,
  commentId,
  update,
}: {
  Comment: CommentModel;
  commentId: string;
  update: StickyCommentUpdate;
}) => {
  const result = await Comment.update({
    where: { id: commentId },
    update: update as never,
    selectionSet: returnedCommentSelectionSet,
  });

  const updatedComment = result.comments[0];

  if (!updatedComment) {
    throw new GraphQLError("Comment could not be updated.");
  }

  return updatedComment;
};

export const stickyComment = ({ Comment }: Input) => {
  return async (
    _parent: unknown,
    args: Args,
    context: GraphQLContext,
    _resolveInfo: GraphQLResolveInfo
  ) => {
    if (!args.commentId) {
      throw new GraphQLError("Comment ID is required.");
    }

    const comment = await getComment(Comment, args.commentId);

    if (comment.isSticky === true) {
      throw new GraphQLError("Comment is already stickied.");
    }

    context.user = await setUserDataOnContext({ context });
    const username = context.user?.username;

    if (!username) {
      throw new GraphQLError("User must be logged in.");
    }

    return updateComment({
      Comment,
      commentId: args.commentId,
      update: {
        isSticky: true,
        stickyAt: new Date().toISOString(),
        stickyByUsername: username,
      },
    });
  };
};

export const unstickyComment = ({ Comment }: Input) => {
  return async (
    _parent: unknown,
    args: Args,
    _context: GraphQLContext,
    _resolveInfo: GraphQLResolveInfo
  ) => {
    if (!args.commentId) {
      throw new GraphQLError("Comment ID is required.");
    }

    const comment = await getComment(Comment, args.commentId);

    if (comment.isSticky !== true) {
      throw new GraphQLError("Comment is not stickied.");
    }

    return updateComment({
      Comment,
      commentId: args.commentId,
      update: {
        isSticky: false,
        stickyAt: null,
        stickyByUsername: null,
      },
    });
  };
};
