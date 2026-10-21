import { resolveForumModeratorRepository } from "../../services/persistence/forumModeratorRepository.js";
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
    // get mod name from username
    const userData = await resolveForumModeratorRepository(context).findModeratorProfile(loggedInUsername);
    const displayName = userData[0]?.ModerationProfile?.displayName || null;
    if (!displayName) {
      throw new Error(`User ${loggedInUsername} is not a moderator`);
    }

    // Check if there's a pending invite first
    const channelWithPendingInvite = await resolveForumModeratorRepository(context).findPendingInvites(channelUniqueName);

    if (!channelWithPendingInvite[0]?.PendingModInvites?.some(invite => invite.username === loggedInUsername)) {
      throw new Error(`No pending moderator invite found for user ${loggedInUsername} in channel ${channelUniqueName}`);
    }


    try {
      const acceptInviteResult = await resolveForumModeratorRepository(context).connectModerator(channelUniqueName, displayName);
      if (!acceptInviteResult.channels[0]) {
        throw new Error("Channel not found. Could not accept invite.");
      }
      const removePendingInviteResult = await resolveForumModeratorRepository(context).disconnectInvite(channelUniqueName, loggedInUsername);
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
