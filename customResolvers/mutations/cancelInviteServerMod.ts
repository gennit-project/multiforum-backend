import { logger } from "../../logger.js";
import type {
  ServerConfigUpdateInput,
  ServerConfigModel,
} from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";

type Args = {
  inviteeUsername: string;
  serverName: string;
};

type Input = {
  ServerConfig: ServerConfigModel;
};

const getResolver = (input: Input) => {
  const { ServerConfig } = input;
  return async (parent: unknown, args: Args, context: GraphQLContext, resolveInfo: GraphQLResolveInfo) => {
    const { serverName, inviteeUsername } = args;
    if (!serverName || !inviteeUsername) {
      throw new Error("All arguments (serverName, inviteeUsername) are required");
    }

    // Note: Using type assertion until OGM types are regenerated
    const removePendingInviteInput = {
      PendingModInvites: [
        {
          disconnect: [
            {
              where: {
                node: {
                  username: inviteeUsername,
                },
              },
            },
          ],
        },
      ],
    } as ServerConfigUpdateInput;

    try {
      const removePendingInviteResult = await ServerConfig.update({
        where: {
          serverName: serverName,
        },
        update: removePendingInviteInput,
      });
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
