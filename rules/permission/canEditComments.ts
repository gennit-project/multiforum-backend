import { rule } from "graphql-shield";
import { checkChannelModPermissions } from "./hasChannelModPermission.js";
import { ModChannelPermission } from "./hasChannelModPermission.js";
import type { GraphQLContext } from "../../types/context.js";

type CanEditCommentsArgs = {
  where?: {
    id?: string;
    id_IN?: string[];
  };
  commentId?: string;
};

type CommentChannelLookup = {
  Channel?: { uniqueName?: string | null } | null;
  DiscussionChannel?: { channelUniqueName?: string | null } | null;
  Event?: {
    EventChannels?: Array<{ channelUniqueName?: string | null }> | null;
  } | null;
  Issue?: { channelUniqueName?: string | null } | null;
};

export const canEditComments = rule({ cache: "contextual" })(
  async (parent: unknown, args: CanEditCommentsArgs, context: GraphQLContext) => {
    const commentIds: string[] = [];

    if (args.commentId) {
      commentIds.push(args.commentId);
    }

    if (args.where?.id) {
      commentIds.push(args.where.id);
    }

    if (args.where?.id_IN?.length) {
      commentIds.push(...args.where.id_IN);
    }

    if (commentIds.length === 0) {
      return new Error("No comment specified for this operation.");
    }

    const Comment = context.ogm.model("Comment");
    const comments = await Comment.find({
      where: { id_IN: commentIds },
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
      permissionCheck: ModChannelPermission.canEditComments,
    });

    if (permissionResult instanceof Error) {
      return permissionResult;
    }

    return true;
  }
);

export const collectCommentChannelConnections = (
  comments: Array<CommentChannelLookup>
) => {
  const channelConnections = new Set<string>();

  for (const comment of comments) {
    if (comment?.Channel?.uniqueName) {
      channelConnections.add(comment.Channel.uniqueName);
    }

    if (comment?.DiscussionChannel?.channelUniqueName) {
      channelConnections.add(comment.DiscussionChannel.channelUniqueName);
    }

    if (comment?.Event?.EventChannels?.length) {
      for (const eventChannel of comment.Event.EventChannels) {
        if (eventChannel?.channelUniqueName) {
          channelConnections.add(eventChannel.channelUniqueName);
        }
      }
    }

    if (comment?.Issue?.channelUniqueName) {
      channelConnections.add(comment.Issue.channelUniqueName);
    }
  }

  return Array.from(channelConnections);
};
