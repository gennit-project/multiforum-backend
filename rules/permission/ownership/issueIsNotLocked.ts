import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../../types/context.js";
import { ERROR_MESSAGES } from "../../errorMessages.js";
import type { IssueWhere } from "../../../src/generated/graphql.js";
import { createContentAuthorizationRepository } from "../../../services/persistence/contentAuthorizationRepository.js";

type IssueIsNotLockedInput = {
  where: IssueWhere;
};

/**
 * Check if the issue is not locked.
 * Locked issues cannot be modified by OPs (only by moderators).
 */
export const issueIsNotLocked = rule({ cache: "contextual" })(
  async (parent: unknown, args: IssueIsNotLockedInput, ctx: GraphQLContext, info: GraphQLResolveInfo) => {
    const { where } = args;
    const issueId = where?.id?.eq;
    if (!issueId) {
      throw new Error(ERROR_MESSAGES.issue.noId);
    }
    const repository =
      ctx.contentAuthorizationRepository ??
      createContentAuthorizationRepository(ctx.driver);
    const issue = await repository.findIssueLock(issueId);

    if (!issue.found) {
      throw new Error(ERROR_MESSAGES.issue.notFound);
    }

    // If locked, deny the action (return false to allow OR with mod permissions)
    if (issue.locked) {
      return false;
    }

    return true;
  }
);
