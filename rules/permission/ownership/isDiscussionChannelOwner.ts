import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../../types/context.js";
import { DiscussionChannelWhere } from "../../../src/generated/graphql.js";
import { setUserDataOnContext } from "../userDataHelperFunctions.js";
import { passesAsServerAdminOrRoot } from "../serverAdminOverride.js";
import { logger } from "../../../logger.js";
import { createChannelPermissionRepository } from "../../../services/persistence/channelPermissionRepository.js";
import { createContentAuthorizationRepository } from "../../../services/persistence/contentAuthorizationRepository.js";

type IsDiscussionChannelOwnerInput = {
  where: DiscussionChannelWhere;
};

export const isDiscussionChannelOwner = rule({ cache: "contextual" })(
  async (parent: unknown, args: IsDiscussionChannelOwnerInput, ctx: GraphQLContext, info: GraphQLResolveInfo) => {
    // Set user data
    // Server admins and the env root pass any ownership-gated mutation (replaces isAdmin).
    if (await passesAsServerAdminOrRoot(ctx)) {
      return true;
    }

    ctx.user = await setUserDataOnContext({
      context: ctx,
    });

    let username = ctx.user.username;
    // Extract the discussionId and channelUniqueName from the various possible argument formats
    let discussionId;
    let channelUniqueName;

    if (args.where) {
      discussionId = args.where.discussionId;
      channelUniqueName = args.where.channelUniqueName;
    }

    if (!discussionId || !channelUniqueName) {
      logger.error("Missing discussionId or channelUniqueName in args:", args);
      return false;
    }

    try {
      // First check if the user is the owner of the discussion
      const contentRepository = ctx.contentAuthorizationRepository ?? createContentAuthorizationRepository(ctx.driver);
      const discussion = await contentRepository.findDiscussionAuthor(discussionId);

      if (discussion.found && discussion.username === username) {
        return true;
      }

      // Next check if the user is an admin of the channel
      const channelRepository = ctx.channelPermissionRepository ?? createChannelPermissionRepository(ctx.driver);
      const channel =
        await channelRepository.findAuthorizationSnapshot(channelUniqueName);

      if (channel) {
        const channelAdmins = channel.Admins.map((admin) => admin.username);
        if (channelAdmins.includes(username ?? "")) {
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.error("Error in isDiscussionChannelOwner:", error);
      return false;
    }
  }
);
