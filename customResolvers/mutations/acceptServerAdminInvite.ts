import { resolveServerAdminRepository } from "../../services/persistence/serverAdminRepository.js";
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

    // Check if there's a pending admin invite first
    const serverConfigWithPendingInvite = await resolveServerAdminRepository(context).findPendingInvites(serverName);

    const serverConfig = serverConfigWithPendingInvite[0];
    if (!serverConfig?.PendingAdminInvites?.some(
      (invite: { username: string }) => invite.username === loggedInUsername
    )) {
      throw new Error(`No pending admin invite found for user ${loggedInUsername}`);
    }


    try {
      const acceptInviteResult = await resolveServerAdminRepository(context).connectAdmin(serverName, loggedInUsername);
      if (!acceptInviteResult.serverConfigs[0]) {
        throw new Error("ServerConfig not found. Could not accept invite.");
      }
      const removePendingInviteResult = await resolveServerAdminRepository(context).disconnectInvite(serverName, loggedInUsername);
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
