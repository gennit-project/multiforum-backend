import { rule } from "graphql-shield";
import type { GraphQLContext } from "../../types/context.js";
import { createContentChannelPermissionRepository } from "../../services/persistence/contentChannelPermissionRepository.js";
import {
  checkChannelModPermissions,
  ModChannelPermission,
} from "./hasChannelModPermission.js";

type Args = {
  commentId?: string;
};

export const canStickyCommentHandler = async (
  _parent: unknown,
  args: Args,
  context: GraphQLContext
) => {
    if (!args.commentId) {
      return new Error("No comment specified for this operation.");
    }

    const repository =
      context.contentChannelPermissionRepository ??
      createContentChannelPermissionRepository(context.driver);
    const lookup = await repository.findCommentChannels([args.commentId]);

    if (!lookup.found) {
      return new Error("Could not find the comment or its associated channel.");
    }

    const channelConnections = lookup.channelUniqueNames;

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
};

export const canStickyComment = rule({ cache: "contextual" })(
  canStickyCommentHandler
);
