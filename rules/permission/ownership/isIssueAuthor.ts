import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../../types/context.js";
import { ERROR_MESSAGES } from "../../errorMessages.js";
import { Issue, IssueWhere } from "../../../src/generated/graphql.js";
import { setUserDataOnContext } from "../userDataHelperFunctions.js";

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
    ctx.user = await setUserDataOnContext({
      context: ctx,
      getPermissionInfo: false,
    });

    const username = ctx.user.username;
    const modName = ctx.user.data?.ModerationProfile?.displayName || null;
    const ogm = ctx.ogm;

    if (!issueId) {
      throw new Error(ERROR_MESSAGES.issue.noId);
    }

    const IssueModel = ogm.model("Issue");

    // Get the issue author using the OGM
    const issues: Issue[] = await IssueModel.find({
      where: { id: issueId },
      selectionSet: `{
        Author {
          ... on User {
            username
          }
          ... on ModerationProfile {
            displayName
          }
        }
      }`,
    });

    if (!issues || issues.length === 0) {
      throw new Error(ERROR_MESSAGES.issue.notFound);
    }

    const issue = issues[0];
    const author = issue?.Author;

    if (!author) {
      throw new Error(ERROR_MESSAGES.issue.noAuthor);
    }

    // The issue author could be a user or a moderation profile
    // @ts-ignore - Author union type
    const authorUsername = author.username;
    // @ts-ignore - Author union type
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
