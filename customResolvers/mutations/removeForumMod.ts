import type { ChannelUpdateInput, UserModel, ChannelModel } from "../../ogm_types.js";
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

type Input = {
  Channel: ChannelModel;
  User: UserModel;
};

const getResolver = (input: Input) => {
  const { Channel, User } = input;
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
      const userData = await User.find({
        where: {
          username,
        },
        selectionSet: `{
          ModerationProfile {
            displayName
          }
        }`,
      });
      displayName = userData[0]?.ModerationProfile?.displayName || null;
      if (!displayName) {
        throw new Error(`User ${username} is not a moderator`);
      }
    }

    const channelUpdateInput: ChannelUpdateInput = {
      Moderators: [
        {
          disconnect: [
            {
              where: {
                node: {
                  displayName,
                },
              },
            },
          ],
        },
      ],
    };

    try {
      const result = await Channel.update({
        where: {
          uniqueName: channelUniqueName,
        },
        update: channelUpdateInput,
      });
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
