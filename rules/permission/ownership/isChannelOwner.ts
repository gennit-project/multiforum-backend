import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../../types/context.js";
import { ERROR_MESSAGES } from "../../errorMessages.js";
import { ChannelWhere } from "../../../src/generated/graphql.js";
import { setUserDataOnContext } from "../userDataHelperFunctions.js";
import { passesAsServerAdminOrRoot } from "../serverAdminOverride.js";
import { logger } from "../../../logger.js";
import { resolveChannelPermissionRepository } from "../../../services/persistence/channelPermissionRepository.js";
import { resolveContentChannelPermissionRepository } from "../../../services/persistence/contentChannelPermissionRepository.js";

type IsChannelOwnerInput = {
  where: ChannelWhere;
  channelUniqueName: string;
  issueId?: string;
  commentId?: string;
};

export const isChannelOwner = rule({ cache: "contextual" })(
  async (parent: unknown, args: IsChannelOwnerInput, ctx: GraphQLContext, info: GraphQLResolveInfo) => {
    logger.info('🔐 isChannelOwner rule called with args:', JSON.stringify(args));

    // set user data
    // Server admins and the env root pass any ownership-gated mutation (replaces isAdmin).
    if (await passesAsServerAdminOrRoot(ctx)) {
      return true;
    }

    ctx.user = await setUserDataOnContext({
      context: ctx,
    });
    let username = ctx.user.username;
    logger.info("username: ", ctx.user);

    const { where, channelUniqueName, issueId, commentId } = args;
    logger.info('args: ', JSON.stringify(args));
    let uniqueName = '';

    const whereUniqueNameEq = where?.uniqueName?.eq;
    if (whereUniqueNameEq) {
      // The channel name can be passed in the where object.
      uniqueName = whereUniqueNameEq;
    }

    if (channelUniqueName) {
      // It can also be passed as a separate argument.
      uniqueName = channelUniqueName;
    }

    // If no channel name is provided but we have a commentId, look it up
    if (!uniqueName && commentId) {
      const repository = resolveContentChannelPermissionRepository(ctx);
      const comment = await repository.findCommentChannelReferences(commentId);

      if (!comment.found) {
        throw new Error(ERROR_MESSAGES.channel.notFound);
      }

      // Try to get channel name from either DiscussionChannel or Channel
      uniqueName =
        comment.discussionChannelUniqueName ||
        comment.directChannelUniqueName ||
        "";

      if (!uniqueName) {
        throw new Error(ERROR_MESSAGES.channel.notFound);
      }
    }

    // If no channel name is provided but we have an issueId, look it up
    // Also check where.id for mutations like updateIssues that pass issue ID in where clause
    const resolvedIssueId = issueId || (where as any)?.id;
    if (!uniqueName && resolvedIssueId) {
      const repository = resolveContentChannelPermissionRepository(ctx);
      const issue = await repository.findIssueChannel(resolvedIssueId);
      logger.info('issue', JSON.stringify(issue));

      if (!issue.found) {
        // Return false instead of throwing to allow OR chain to continue
        return false;
      }

      uniqueName = issue.channelUniqueName ?? "";
    }

    if (!uniqueName) {
      // Return false instead of throwing to allow OR chain to continue
      return false;
    }

    const channelRepository = resolveChannelPermissionRepository(ctx);
    const channel = await channelRepository.findAuthorizationSnapshot(uniqueName);

    if (!channel) {
      throw new Error(ERROR_MESSAGES.channel.notFound);
    }

    // Get the list of channel owners.
    const channelOwners = channel.Admins.map((admin) => admin.username);

    // Check if the user is in the list of channel owners.
    if (!channelOwners.includes(username ?? "")) {
      return false;  // Permission check - return false to allow OR to work
    }

    return true;
  }
);
