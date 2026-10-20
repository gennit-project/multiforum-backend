import { resolveForumModeratorRepository } from "../../services/persistence/forumModeratorRepository.js";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";
import { logger } from "../../logger.js";

type Args = {
  inviteeUsername: string;
  channelUniqueName: string;
};

const getResolver = () => {
  return async (parent: unknown, args: Args, context: GraphQLContext, resolveInfo: GraphQLResolveInfo) => {
    const { channelUniqueName, inviteeUsername } = args;

    if (!channelUniqueName || !inviteeUsername) {
      throw new Error(
        "All arguments (channelUniqueName, inviteeUsername) are required"
      );
    }

    try {
      const result = await resolveForumModeratorRepository(context).disconnectInvite(channelUniqueName, inviteeUsername);
      if (!result.channels?.length) {
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
