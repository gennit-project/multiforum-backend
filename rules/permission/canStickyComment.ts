import { rule } from "graphql-shield";
import type { GraphQLContext } from "../../types/context.js";
import { collectCommentChannelConnections } from "./canEditComments.js";
import {
  checkChannelModPermissions,
  ModChannelPermission,
} from "./hasChannelModPermission.js";

type Args = {
  commentId?: string;
};

export const canStickyComment = rule({ cache: "contextual" })(
  async (_parent: unknown, args: Args, context: GraphQLContext) => {
    if (!args.commentId) {
      return new Error("No comment specified for this operation.");
    }

    const Comment = context.ogm.model("Comment");
    const comments = await Comment.find({
      where: { id: args.commentId },
      selectionSet: `{
        Channel { uniqueName }
        DiscussionChannel { channelUniqueName }
        Event { EventChannels { channelUniqueName } }
        Issue { channelUniqueName }
      }`,
    });

    if (!comments || comments.length === 0) {
      return new Error("Could not find the comment or its associated channel.");
    }

    const channelConnections = collectCommentChannelConnections(comments);

    if (channelConnections.length === 0) {
      return new Error("No channel specified for this operation.");
    }

    const permissionResult = await checkChannelModPermissions({
      channelConnections,
      context,
      permissionCheck: ModChannelPermission.canHideComment,
    });

    if (permissionResult instanceof Error) {
      return permissionResult;
    }

    return true;
  }
);
