import type {
  ChannelUpdateInput,
  ChannelModel,
} from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
type Args = {
  channelUniqueName: string;
};

type Input = {
  Channel: ChannelModel;
};

const getResolver = (input: Input) => {
  const { Channel } = input;
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

    // Check if there's a pending owner invite first
    const channelWithPendingInvite = await Channel.find({
      where: {
        uniqueName: channelUniqueName,
      },
      selectionSet: `{
        PendingOwnerInvites {
          username
        }
      }`,
    });

    if (!channelWithPendingInvite[0]?.PendingOwnerInvites?.some(invite => invite.username === loggedInUsername)) {
      throw new Error(`No pending owner invite found for user ${loggedInUsername} in channel ${channelUniqueName}`);
    }

    const addChannelOwnerInput: ChannelUpdateInput = {
      Admins: [
        {
          connect: [
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

    const removePendingInviteInput: ChannelUpdateInput = {
      PendingOwnerInvites: [
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
        update: addChannelOwnerInput,
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
      console.error(e);
      return false;
    }
  };
};

export default getResolver;
