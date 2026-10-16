import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../../types/context.js";
import { ERROR_MESSAGES } from "../../errorMessages.js";
import type { IssueWhere } from "../../../src/generated/graphql.js";
import { setUserDataOnContext } from "../userDataHelperFunctions.js";
import { passesAsServerAdminOrRoot } from "../serverAdminOverride.js";
import { createContentAuthorizationRepository } from "../../../services/persistence/contentAuthorizationRepository.js";

type IsIssueAuthorInput = {
  where: IssueWhere;
};

/**
 * Check if the current user is the author of the issue.
 * The issue author can be either a User or a ModerationProfile.
 */
export const isIssueAuthor = rule({ cache: "contextual" })(
  async (parent: unknown, args: IsIssueAuthorInput, ctx: GraphQLContext, info: GraphQLResolveInfo) => {
    const { where } = args;
    const issueId = where?.id;

    // Set user data
    // Server admins and the env root pass any ownership-gated mutation (replaces isAdmin).
    if (await passesAsServerAdminOrRoot(ctx)) {
      return true;
    }

    ctx.user = await setUserDataOnContext({
      context: ctx,
    });

    const username = ctx.user.username;
    const modName = ctx.user.data?.ModerationProfile?.displayName || null;
    if (!issueId) {
      throw new Error(ERROR_MESSAGES.issue.noId);
    }
    const repository =
      ctx.contentAuthorizationRepository ??
      createContentAuthorizationRepository(ctx.driver);
    const result = await repository.findIssueAuthor(issueId);

    if (!result.found) {
      throw new Error(ERROR_MESSAGES.issue.notFound);
    }
    const author = result.actor;

    if (!author) {
      throw new Error(ERROR_MESSAGES.issue.noAuthor);
    }

    const authorUsername = author.username;
    const authorModProfileName = author.displayName;

    // Check if the current user matches the author
    if (authorUsername && authorUsername === username) {
      return true;
    }
    if (authorModProfileName && authorModProfileName === modName) {
      return true;
    }

    return false; // Permission check - return false to allow OR to work
  }
);
