import type { GraphQLResolveInfo } from "graphql";
import type { ServerSecretModel } from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import { logger } from "../../logger.js";

type Input = {
  ServerSecret: ServerSecretModel;
};

type Args = {
  pluginId: string;
  key: string;
};

const getResolver = ({ ServerSecret }: Input) => {
  return async (
    _parent: unknown,
    { pluginId, key }: Args,
    _context: GraphQLContext,
    _resolveInfo: GraphQLResolveInfo,
  ) => {
    try {
      const existingSecrets = await ServerSecret.find({
        where: {
          AND: [{ pluginId }, { key }],
        },
      });

      if (existingSecrets.length === 0) {
        return false;
      }

      await ServerSecret.delete({
        where: { id: existingSecrets[0].id },
      });

      return true;
    } catch (error: unknown) {
      logger.error("Error in deleteServerPluginSecret resolver:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to delete server plugin secret: ${message}`);
    }
  };
};

export default getResolver;
