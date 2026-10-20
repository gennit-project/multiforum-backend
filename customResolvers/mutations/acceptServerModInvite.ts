import { resolveServerModeratorRepository } from "../../services/persistence/serverModeratorRepository.js";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { logger } from "../../logger.js";

type Args = {
  serverName: string;
};

const getResolver = () => {
  return async (parent: unknown, args: Args, context: GraphQLContext, resolveInfo: GraphQLResolveInfo) => {
    const { serverName } = args;
    if (!serverName) {
      throw new Error("All arguments (serverName) are required");
    }

    // Set loggedInUsername to null explicitly if not present
    context.user = await setUserDataOnContext({
      context,
    });

    const loggedInUsername = context.user?.username || null;

    if (!loggedInUsername) {
      throw new Error("User must be logged in");
    }

    // Get mod name from username
    const userData = await resolveServerModeratorRepository(context).findModeratorProfile(loggedInUsername);
    const displayName = userData[0]?.ModerationProfile?.displayName || null;
    if (!displayName) {
      throw new Error(`User ${loggedInUsername} is not a moderator`);
    }

    // Check if there's a pending mod invite first
    const serverConfigWithPendingInvite = await resolveServerModeratorRepository(context).findPendingInvites(serverName);

    const serverConfig = serverConfigWithPendingInvite[0];
    if (!serverConfig?.PendingModInvites?.some(
      (invite: { username: string }) => invite.username === loggedInUsername
    )) {
      throw new Error(`No pending moderator invite found for user ${loggedInUsername}`);
    }


    try {
      const acceptInviteResult = await resolveServerModeratorRepository(context).connectModerator(serverName, displayName);
      if (!acceptInviteResult.serverConfigs[0]) {
        throw new Error("ServerConfig not found. Could not accept invite.");
      }
      const removePendingInviteResult = await resolveServerModeratorRepository(context).disconnectInvite(serverName, loggedInUsername);
      if (!removePendingInviteResult.serverConfigs[0]) {
        throw new Error("ServerConfig not found. Could not remove pending invite");
      }
      return true;
    } catch (e) {
      logger.error(e);
      return false;
    }
  };
};

export default getResolver;
