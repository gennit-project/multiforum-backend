import type {
  ChannelUpdateInput,
  ChannelModel,
  UserModel,
} from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { logger } from "../../logger.js";

type Args = {
  channelUniqueName: string;
};

type Input = {
  Channel: ChannelModel;
  User: UserModel;
};

const getResolver = (input: Input) => {
  const { Channel, User } = input;
  return async (parent: unknown, args: Args, context: GraphQLContext, resolveInfo: GraphQLResolveInfo) => {
    const { channelUniqueName } = args;
    if (!channelUniqueName) {
      throw new Error("All arguments (channelUniqueName) are required");
    }

    // Set loggedInUsername to null explicitly if not present
    context.user = await setUserDataOnContext({
      context,
      getPermissionInfo: false,
    });

    const loggedInUsername = context.user?.username || null;

    if (!loggedInUsername) {
      throw new Error("User must be logged in");
    }
    // get mod name from username
    const userData = await User.find({
      where: {
        username: loggedInUsername,
      },
      selectionSet: `{
        ModerationProfile {
          displayName
        }
      }`,
    });
    const displayName = userData[0]?.ModerationProfile?.displayName || null;
    if (!displayName) {
      throw new Error(`User ${loggedInUsername} is not a moderator`);
    }

    // Check if there's a pending invite first
    const channelWithPendingInvite = await Channel.find({
      where: {
        uniqueName: channelUniqueName,
      },
      selectionSet: `{
        PendingModInvites {
          username
        }
      }`,
    });

    if (!channelWithPendingInvite[0]?.PendingModInvites?.some(invite => invite.username === loggedInUsername)) {
      throw new Error(`No pending moderator invite found for user ${loggedInUsername} in channel ${channelUniqueName}`);
    }

    const addChannelModInput: ChannelUpdateInput = {
      Moderators: [
        {
          connect: [
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

    const removePendingInviteInput: ChannelUpdateInput = {
      PendingModInvites: [
        {
          disconnect: [
            {
              where: {
                node: {
                  username: loggedInUsername,
                },
              },
            },
          ],
        },
      ],
    };

    try {
      const acceptInviteResult = await Channel.update({
        where: {
          uniqueName: channelUniqueName,
        },
        update: addChannelModInput,
      });
      if (!acceptInviteResult.channels[0]) {
        throw new Error("Channel not found. Could not accept invite.");
      }
      const removePendingInviteResult = await Channel.update({
        where: {
          uniqueName: channelUniqueName,
        },
        update: removePendingInviteInput,
      });
      if (!removePendingInviteResult.channels[0]) {
        throw new Error("Channel not found. Could not remove pending invite");
      }
      return true;
    } catch (e) {
      logger.error(e);
      return false;
    }
  };
};

export default getResolver;
