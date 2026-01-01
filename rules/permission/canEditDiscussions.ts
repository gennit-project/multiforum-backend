import { rule } from "graphql-shield";
import { checkChannelModPermissions } from "./hasChannelModPermission.js";
import { ModChannelPermission } from "./hasChannelModPermission.js";

type CanEditDiscussionsArgs = {
  where?: {
    id?: string;
    id_IN?: string[];
  };
  discussionId?: string;
};

export const canEditDiscussions = rule({ cache: "contextual" })(
  async (parent: any, args: CanEditDiscussionsArgs, context: any) => {
    const discussionIds: string[] = [];

    if (args.discussionId) {
      discussionIds.push(args.discussionId);
    }

    if (args.where?.id) {
      discussionIds.push(args.where.id);
    }

    if (args.where?.id_IN?.length) {
      discussionIds.push(...args.where.id_IN);
    }

    if (discussionIds.length === 0) {
      return new Error("No discussion specified for this operation.");
    }

    const Discussion = context.ogm.model("Discussion");
    const discussions = await Discussion.find({
      where: { id_IN: discussionIds },
      selectionSet: `{
        DiscussionChannels { channelUniqueName }
      }`,
    });

    if (!discussions || discussions.length === 0) {
      return new Error("Could not find the discussion or its associated channel.");
    }

    const channelConnections = new Set<string>();

    for (const discussion of discussions) {
      const channels = discussion?.DiscussionChannels || [];
      for (const channel of channels) {
        if (channel?.channelUniqueName) {
          channelConnections.add(channel.channelUniqueName);
        }
      }
    }

    if (channelConnections.size === 0) {
      return new Error("No channel specified for this operation.");
    }

    const permissionResult = await checkChannelModPermissions({
      channelConnections: Array.from(channelConnections),
      context,
      permissionCheck: ModChannelPermission.canEditDiscussions,
    });

    if (permissionResult instanceof Error) {
      return permissionResult;
    }

    return true;
  }
);
