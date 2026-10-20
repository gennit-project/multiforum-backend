import { resolveForumOwnerRepository } from "../../services/persistence/forumOwnerRepository.js";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { logger } from "../../logger.js";
type Args = {
  channelUniqueName: string;
};

const getResolver = () => {
  return async (parent: unknown, args: Args, context: GraphQLContext, resolveInfo: GraphQLResolveInfo) => {
    const { channelUniqueName } = args;
    if (!channelUniqueName) {
      throw new Error("All arguments (channelUniqueName) are required");
    }

    // Set loggedInUsername to null explicitly if not present
    context.user = await setUserDataOnContext({
      context,
    });

    const loggedInUsername = context.user?.username || null;

    if (!loggedInUsername) {
      throw new Error("User must be logged in");
    }

    // Check if there's a pending owner invite first
    const channelWithPendingInvite = await resolveForumOwnerRepository(context).findPendingInvites(channelUniqueName);

    if (!channelWithPendingInvite[0]?.PendingOwnerInvites?.some(invite => invite.username === loggedInUsername)) {
      throw new Error(`No pending owner invite found for user ${loggedInUsername} in channel ${channelUniqueName}`);
    }

    try {
      const acceptInviteResult = await resolveForumOwnerRepository(context).connectOwner(channelUniqueName, loggedInUsername);
      if (!acceptInviteResult.channels[0]) {
        throw new Error("Channel not found. Could not accept invite.");
      }
      const removePendingInviteResult = await resolveForumOwnerRepository(context).disconnectInvite(channelUniqueName, loggedInUsername);
      if (!removePendingInviteResult.channels[0]) {
        throw new Error("Channel not found. Could not remove pending invite");
      }
      return true;
    } catch (e) {
      logger.error(e);
      return false;
    }
  };
};

export default getResolver;
