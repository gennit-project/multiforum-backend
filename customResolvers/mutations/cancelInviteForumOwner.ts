import { resolveForumOwnerRepository } from "../../services/persistence/forumOwnerRepository.js";
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
      const result = await resolveForumOwnerRepository(context).disconnectInvite(channelUniqueName, inviteeUsername);
      if (!result.channels[0]) {
        throw new Error("Channel not found");
      }
      return true;
    } catch (e) {
      logger.error("Error updating channel:", e);
      return false;
    }    
  };
};

export default getResolver;
