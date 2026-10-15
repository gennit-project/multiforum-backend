import { rule } from "graphql-shield";
import { checkChannelModPermissions } from "./hasChannelModPermission.js";
import { ModChannelPermission } from "./hasChannelModPermission.js";
import type { GraphQLContext } from "../../types/context.js";
import { createContentChannelPermissionRepository } from "../../services/persistence/contentChannelPermissionRepository.js";

type CanEditDiscussionsArgs = {
  where?: {
    id?: string;
    id_IN?: string[];
  };
  discussionId?: string;
};

export const canEditDiscussionsHandler = async (
  _parent: unknown,
  args: CanEditDiscussionsArgs,
  context: GraphQLContext
) => {
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

    const repository =
      context.contentChannelPermissionRepository ??
      createContentChannelPermissionRepository(context.driver);
    const lookup = await repository.findDiscussionChannels(discussionIds);

    if (!lookup.found) {
      return new Error("Could not find the discussion or its associated channel.");
    }

    const channelConnections = lookup.channelUniqueNames;

    if (channelConnections.length === 0) {
      return new Error("No channel specified for this operation.");
    }

    const permissionResult = await checkChannelModPermissions({
      channelConnections,
      context,
      permissionCheck: ModChannelPermission.canEditDiscussions,
    });

    if (permissionResult instanceof Error) {
      return permissionResult;
    }

    return true;
};

export const canEditDiscussions = rule({ cache: "contextual" })(
  canEditDiscussionsHandler
);
