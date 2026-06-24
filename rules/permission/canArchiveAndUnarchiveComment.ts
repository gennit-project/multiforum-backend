import { checkChannelModPermissions } from "./hasChannelModPermission.js";
import { ModChannelPermission } from "./hasChannelModPermission.js";
import { resolveChannelForModPermission } from "./resolveChannelForModPermission.js";
import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";

export interface CanArchiveAndUnarchiveCommentArgs {
  channelUniqueName?: string;
  issueId?: string;
  commentId?: string;
}

export const canArchiveAndUnarchiveComment = rule({ cache: "contextual" })(
  async (parent: unknown, args: CanArchiveAndUnarchiveCommentArgs, context: GraphQLContext, info: GraphQLResolveInfo) => {
    let channelUniqueName = args.channelUniqueName;
    const issueId = args.issueId;
    const commentId = args.commentId;
    
    // If channelUniqueName is not provided, look it up from the issue and/or
    // comment. Both lookups run (comment last) to match the original ordering.
    let issue;
    let comment;
    if (!channelUniqueName) {
      if (issueId) {
        issue = await context.ogm.model("Issue").find({
          where: { id: issueId },
          selectionSet: `{
            channelUniqueName
          }`,
        });
      }
      if (commentId) {
        comment = await context.ogm.model("Comment").find({
          where: { id: commentId },
          selectionSet: `{
            Channel {
              uniqueName
            }
          }`,
        });
      }
    }

    const resolution = resolveChannelForModPermission({
      channelUniqueName,
      issueId,
      commentId,
      issue,
      comment,
    });
    if (resolution.error) {
      return resolution.error;
    }
    channelUniqueName = resolution.channelUniqueName;

    // Check if the user has the required permission in the specified channel
    const permissionResult = await checkChannelModPermissions({
        channelConnections: [channelUniqueName],
        context,
        permissionCheck: ModChannelPermission.canHideComment
    });
    
    // If the user does not have the required permission, return an error
    if (permissionResult instanceof Error) {
        return permissionResult;
    }
    
    // If the user has the required permission, return true
    return true;
}
);
