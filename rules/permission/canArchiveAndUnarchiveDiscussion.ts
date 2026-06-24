import { checkChannelModPermissions } from "./hasChannelModPermission.js";
import { ModChannelPermission } from "./hasChannelModPermission.js";
import { resolveChannelForModPermission } from "./resolveChannelForModPermission.js";
import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";

interface CanArchiveAndUnarchiveDiscussionArgs {
  channelUniqueName?: string;
  issueId?: string;
  where?: { id?: string };
}

export const canArchiveAndUnarchiveDiscussion = rule({ cache: "contextual" })(
  async (parent: unknown, args: CanArchiveAndUnarchiveDiscussionArgs, context: GraphQLContext, info: GraphQLResolveInfo) => {
    let channelUniqueName = args.channelUniqueName;
    // Support both direct issueId arg and where.id from updateIssues mutation
    const issueId = args.issueId || args.where?.id;

    console.log('can archive and unarchive discussion');
    console.log("channelUniqueName", channelUniqueName);
    console.log("issueId", issueId);

    // If channelUniqueName is not provided, look it up from the issue.
    let issue;
    if (!channelUniqueName && issueId) {
      issue = await context.ogm.model("Issue").find({
        where: { id: issueId },
        selectionSet: `{
          channelUniqueName
        }`,
      });
    }

    const resolution = resolveChannelForModPermission({
      channelUniqueName,
      issueId,
      issue,
    });
    if (resolution.error) {
      return resolution.error;
    }
    channelUniqueName = resolution.channelUniqueName;

    // Check if the user has the required permission in the specified channel
    const permissionResult = await checkChannelModPermissions({
        channelConnections: [channelUniqueName],
        context,
        permissionCheck: ModChannelPermission.canHideDiscussion
    });
    
    // If the user does not have the required permission, return an error
    if (permissionResult instanceof Error) {
        return permissionResult;
    }
    
    // If the user has the required permission, return true
    return true;
}
);
