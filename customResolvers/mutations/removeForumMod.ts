import { resolveForumModeratorRepository } from "../../services/persistence/forumModeratorRepository.js";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";
import { logger } from "../../logger.js";

type Args = {
  channelUniqueName: string;
  // Preferred: moderators are identified by their public mod-profile name.
  // ModerationProfile.User is denied to everyone, so clients cannot know the
  // username behind a profile.
  modProfileName?: string | null;
  // Deprecated: kept so frontends deployed before modProfileName existed keep
  // working. Remove once no client sends it.
  username?: string | null;
};

const getResolver = () => {
  return async (parent: unknown, args: Args, context: GraphQLContext, resolveInfo: GraphQLResolveInfo) => {
    const { channelUniqueName, modProfileName, username } = args;

    if (!channelUniqueName) {
      throw new Error("channelUniqueName is required");
    }
    if (Boolean(modProfileName) === Boolean(username)) {
      throw new Error("Provide exactly one of modProfileName or username");
    }

    let displayName = modProfileName || null;
    if (!displayName) {
      // Legacy path: resolve the username to its mod profile server-side.
      const userData = await resolveForumModeratorRepository(context).findModeratorProfile(username);
      displayName = userData[0]?.ModerationProfile?.displayName || null;
      if (!displayName) {
        throw new Error(`User ${username} is not a moderator`);
      }
    }

    try {
      const result = await resolveForumModeratorRepository(context).disconnectModerator(channelUniqueName, displayName);
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
