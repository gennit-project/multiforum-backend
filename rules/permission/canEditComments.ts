import { idsFromScalarFilter, type IdFilter } from "../../utils/scalarFilter.js";
import { rule } from "graphql-shield";
import { checkChannelModPermissions } from "./hasChannelModPermission.js";
import { ModChannelPermission } from "./hasChannelModPermission.js";
import type { GraphQLContext } from "../../types/context.js";
import { createContentChannelPermissionRepository } from "../../services/persistence/contentChannelPermissionRepository.js";

type CanEditCommentsArgs = {
  where?: {
    id?: IdFilter;
    id_IN?: string[] | null;
  } | null;
  commentId?: string;
};

export const canEditCommentsHandler = async (
  _parent: unknown,
  args: CanEditCommentsArgs,
  context: GraphQLContext
) => {
    const commentIds: string[] = [];

    if (args.commentId) {
      commentIds.push(args.commentId);
    }

    commentIds.push(...idsFromScalarFilter(args.where?.id));

    if (args.where?.id_IN?.length) {
      commentIds.push(...args.where.id_IN);
    }

    if (commentIds.length === 0) {
      return new Error("No comment specified for this operation.");
    }

    const repository =
      context.contentChannelPermissionRepository ??
      createContentChannelPermissionRepository(context.driver);
    const lookup = await repository.findCommentChannels(commentIds);

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
      permissionCheck: ModChannelPermission.canEditComments,
    });

    if (permissionResult instanceof Error) {
      return permissionResult;
    }

    return true;
};

export const canEditComments = rule({ cache: "strict" })(
  canEditCommentsHandler
);
