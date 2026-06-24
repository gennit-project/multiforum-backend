import { checkChannelModPermissions } from "./hasChannelModPermission.js";
import { ModChannelPermission } from "./hasChannelModPermission.js";
import { resolveChannelForModPermission } from "./resolveChannelForModPermission.js";
import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";

export interface CanReportArgs {
  channelUniqueName?: string;
  issueId?: string;
}

export const canReport = rule({ cache: "contextual" })(
  async (parent: unknown, args: CanReportArgs, context: GraphQLContext, info: GraphQLResolveInfo) => {
    let channelUniqueName = args.channelUniqueName;
    const issueId = args.issueId;
    
    console.log('can report');
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
        permissionCheck: ModChannelPermission.canReport
    });
    
    // If the user does not have the required permission, return an error
    if (permissionResult instanceof Error) {
        return permissionResult;
    }
    
    // If the user has the required permission, return true
    return true;
}
);
