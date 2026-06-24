import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../../types/context.js";
import { ERROR_MESSAGES } from "../../errorMessages.js";
import { Issue, IssueWhere } from "../../../src/generated/graphql.js";

type IssueIsNotLockedInput = {
  where: IssueWhere;
};

// Extended Issue type to include locked field (exists in schema but not yet in generated types)
type IssueWithLocked = Issue & { locked?: boolean };

/**
 * Check if the issue is not locked.
 * Locked issues cannot be modified by OPs (only by moderators).
 */
export const issueIsNotLocked = rule({ cache: "contextual" })(
  async (parent: unknown, args: IssueIsNotLockedInput, ctx: GraphQLContext, info: GraphQLResolveInfo) => {
    const { where } = args;
    const issueId = where?.id;
    const ogm = ctx.ogm;

    if (!issueId) {
      throw new Error(ERROR_MESSAGES.issue.noId);
    }

    const IssueModel = ogm.model("Issue");

    const issues = (await IssueModel.find({
      where: { id: issueId },
      selectionSet: `{ locked }`,
    })) as unknown as IssueWithLocked[];

    if (!issues || issues.length === 0) {
      throw new Error(ERROR_MESSAGES.issue.notFound);
    }

    const issue = issues[0];

    // If locked, deny the action (return false to allow OR with mod permissions)
    if (issue.locked) {
      return false;
    }

    return true;
  }
);
