import { resolveServerAdminRepository } from "../../services/persistence/serverAdminRepository.js";
import { logger } from "../../logger.js";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";

type Args = {
  inviteeUsername: string;
  serverName: string;
};

const getResolver = () => {
  return async (parent: unknown, args: Args, context: GraphQLContext, resolveInfo: GraphQLResolveInfo) => {
    const { serverName, inviteeUsername } = args;
    if (!serverName || !inviteeUsername) {
      throw new Error("All arguments (serverName, inviteeUsername) are required");
    }

    try {
      const removePendingInviteResult = await resolveServerAdminRepository(context).disconnectInvite(serverName, inviteeUsername);
      if (!removePendingInviteResult.serverConfigs[0]) {
        throw new Error("ServerConfig not found. Could not cancel invite");
      }
      return true;
    } catch (e) {
      logger.error(e);
      return false;
    }
  };
};

export default getResolver;
