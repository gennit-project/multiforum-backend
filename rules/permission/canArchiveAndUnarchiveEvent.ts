import { checkChannelModPermissions } from "./hasChannelModPermission.js";
import { ModChannelPermission } from "./hasChannelModPermission.js";
import { resolveChannelForModPermission } from "./resolveChannelForModPermission.js";
import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import { logger } from "../../logger.js";

interface CanArchiveAndUnarchiveEventArgs {
  channelUniqueName?: string;
  issueId?: string;
}

export const canArchiveAndUnarchiveEvent = rule({ cache: "contextual" })(
  async (parent: unknown, args: CanArchiveAndUnarchiveEventArgs, context: GraphQLContext, info: GraphQLResolveInfo) => {
    let channelUniqueName = args.channelUniqueName;
    const issueId = args.issueId;
    
    logger.info('can archive and unarchive event');
    logger.info("channelUniqueName", channelUniqueName);
    logger.info("issueId", issueId);
    
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
        permissionCheck: ModChannelPermission.canHideEvent
    });
    
    // If the user does not have the required permission, return an error
    if (permissionResult instanceof Error) {
        return permissionResult;
    }
    
    // If the user has the required permission, return true
    return true;
}
);
