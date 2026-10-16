import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../../types/context.js";
import { ERROR_MESSAGES } from "../../errorMessages.js";
import type { CommentWhere } from "../../../src/generated/graphql.js";
import { setUserDataOnContext } from "../userDataHelperFunctions.js";
import { passesAsServerAdminOrRoot } from "../serverAdminOverride.js";
import { logger } from "../../../logger.js";
import { createContentAuthorizationRepository } from "../../../services/persistence/contentAuthorizationRepository.js";

type IsCommentAuthorInput = {
  where: CommentWhere;
  update: CommentWhere;
};

export const isCommentAuthor = rule({ cache: "contextual" })(
  async (parent: unknown, args: IsCommentAuthorInput, ctx: GraphQLContext, info: GraphQLResolveInfo) => {
    logger.info("isCommentAuthor rule");
    let commentId;
    const { where } = args;
    if (where) {
      commentId = where.id;
    }

    // set user data
    // Server admins and the env root pass any ownership-gated mutation (replaces isAdmin).
    if (await passesAsServerAdminOrRoot(ctx)) {
      return true;
    }

    ctx.user = await setUserDataOnContext({
      context: ctx,
    });

    let username = ctx.user.username;
    let modName =  ctx.user.data?.ModerationProfile?.displayName || null;
    logger.info("username: ", username);
    logger.info("modName: ", modName);

    if (!commentId) {
      throw new Error(ERROR_MESSAGES.comment.noId);
    }
    const repository =
      ctx.contentAuthorizationRepository ??
      createContentAuthorizationRepository(ctx.driver);
    const result = await repository.findCommentAuthor(commentId);

    if (!result.found) {
      throw new Error(ERROR_MESSAGES.comment.notFound);
    }
    const author = result.actor;

    // The comment owner could be a user or a moderation profile.
    // For a user, the username is stored on the user object.
    // For a moderation profile, the displayName is stored on
    // the moderation profile object.
    if (!author) {
      throw new Error(ERROR_MESSAGES.comment.noOwner);
    }

    const authorUsername = author.username;
    const authorModProfileName = author.displayName;
    if (authorUsername) {
      return authorUsername === username;
    }
    if (authorModProfileName) {
      return authorModProfileName === modName;
    }
    throw new Error(ERROR_MESSAGES.comment.noOwner);
  }
);
