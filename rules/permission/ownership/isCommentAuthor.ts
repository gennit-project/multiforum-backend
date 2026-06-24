import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../../types/context.js";
import { ERROR_MESSAGES } from "../../errorMessages.js";
import { Comment, CommentWhere } from "../../../src/generated/graphql.js";
import { setUserDataOnContext } from "../userDataHelperFunctions.js";
import { logger } from "../../../logger.js";

type IsCommentAuthorInput = {
  where: CommentWhere;
  update: CommentWhere;
};

export const isCommentAuthor = rule({ cache: "contextual" })(
  async (parent: unknown, args: IsCommentAuthorInput, ctx: GraphQLContext, info: GraphQLResolveInfo) => {
    logger.info("isCommentAuthor rule");
    const { where } = args;
    const commentId  = where.id

    // set user data
    ctx.user = await setUserDataOnContext({
      context: ctx,
      getPermissionInfo: false,
    });

    let username = ctx.user.username;
    let modName =  ctx.user.data?.ModerationProfile?.displayName || null;
    logger.info("username: ", username);
    logger.info("modName: ", modName);

    let ogm = ctx.ogm;

    if (!commentId) {
      throw new Error(ERROR_MESSAGES.comment.noId);
    }
    const CommentModel = ogm.model("Comment");

    // Get the comment owner by using the OGM on the
    // Comment model.
    const comments: Comment[] = await CommentModel.find({
      where: { id: commentId },
      selectionSet: `{
        CommentAuthor {
          ... on User {
            username
          }
          ... on ModerationProfile {
            displayName
          }
        }
      }`,
    });

    if (!comments || comments.length === 0) {
      throw new Error(ERROR_MESSAGES.comment.notFound);
    }
    const comment = comments[0];

    // Get the comment author.
    const author = comment?.CommentAuthor;
    let authorUsername;
    let authorModProfileName;

    // The comment owner could be a user or a moderation profile.
    // For a user, the username is stored on the user object.
    // For a moderation profile, the displayName is stored on
    // the moderation profile object.
    if (!author) {
      throw new Error(ERROR_MESSAGES.comment.noOwner);
    }

    // @ts-ignore
    if (author.username) {
      // @ts-ignore
      authorUsername = author.username;
    } else if (author.displayName) {
      authorModProfileName = author.displayName;
    } else {
      throw new Error(ERROR_MESSAGES.comment.noOwner);
    }

    // Check if the user is the comment author.
    if (authorUsername && authorUsername !== username) {
      return false;  // Permission check - return false to allow OR to work
    }
    if (authorModProfileName && authorModProfileName !== modName) {
      return false;  // Permission check - return false to allow OR to work
    }
    return true;
  }
);
