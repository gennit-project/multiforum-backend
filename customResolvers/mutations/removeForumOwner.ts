import { resolveForumOwnerRepository } from "../../services/persistence/forumOwnerRepository.js";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";
import { logger } from "../../logger.js";

type Args = {
  username: string;
  channelUniqueName: string;
};

const getResolver = () => {
  return async (parent: unknown, args: Args, context: GraphQLContext, resolveInfo: GraphQLResolveInfo) => {
    const { channelUniqueName, username } = args;

    if (!channelUniqueName || !username) {
      throw new Error(
        "All arguments (channelUniqueName, username) are required"
      );
    }

    try {
      const result = await resolveForumOwnerRepository(context).disconnectOwner(channelUniqueName, username);
      if (!result.channels[0]) {
        throw new Error("Channel not found");
      }
      return true;
    } catch (e) {
      logger.error(e);
      return false;
    }
  };
};

export default getResolver;
