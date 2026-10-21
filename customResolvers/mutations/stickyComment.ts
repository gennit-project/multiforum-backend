import { GraphQLError } from "graphql";
import type { GraphQLResolveInfo } from "graphql";
import type { StickyCommentRepository, StickyCommentUpdate } from "../../services/persistence/stickyCommentRepository.js";
import type { GraphQLContext } from "../../types/context.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";

type Args = {
  commentId: string;
};

type Input = { stickyCommentRepository: StickyCommentRepository };

const getComment = async (stickyCommentRepository: StickyCommentRepository, commentId: string) => {
  const comments = await stickyCommentRepository.findState(commentId);

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
  stickyCommentRepository,
  commentId,
  update,
}: {
  stickyCommentRepository: StickyCommentRepository;
  commentId: string;
  update: StickyCommentUpdate;
}) => {
  const comments = await stickyCommentRepository.updateMetadata(commentId, update);
  const updatedComment = comments[0];

  if (!updatedComment) {
    throw new GraphQLError("Comment could not be updated.");
  }

  return updatedComment;
};

export const stickyComment = ({ stickyCommentRepository }: Input) => {
  return async (
    _parent: unknown,
    args: Args,
    context: GraphQLContext,
    _resolveInfo: GraphQLResolveInfo
  ) => {
    if (!args.commentId) {
      throw new GraphQLError("Comment ID is required.");
    }

    const comment = await getComment(stickyCommentRepository, args.commentId);

    if (comment.isSticky === true) {
      throw new GraphQLError("Comment is already stickied.");
    }

    context.user = await setUserDataOnContext({ context });
    const username = context.user?.username;

    if (!username) {
      throw new GraphQLError("User must be logged in.");
    }

    return updateComment({
      stickyCommentRepository,
      commentId: args.commentId,
      update: {
        isSticky: true,
        stickyAt: new Date().toISOString(),
        stickyByUsername: username,
      },
    });
  };
};

export const unstickyComment = ({ stickyCommentRepository }: Input) => {
  return async (
    _parent: unknown,
    args: Args,
    _context: GraphQLContext,
    _resolveInfo: GraphQLResolveInfo
  ) => {
    if (!args.commentId) {
      throw new GraphQLError("Comment ID is required.");
    }

    const comment = await getComment(stickyCommentRepository, args.commentId);

    if (comment.isSticky !== true) {
      throw new GraphQLError("Comment is not stickied.");
    }

    return updateComment({
      stickyCommentRepository,
      commentId: args.commentId,
      update: {
        isSticky: false,
        stickyAt: null,
        stickyByUsername: null,
      },
    });
  };
};
