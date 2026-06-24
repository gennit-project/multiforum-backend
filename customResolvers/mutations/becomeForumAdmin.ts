import type {
  ChannelUpdateInput,
  ChannelModel,
} from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { channelHasZeroAdmins } from "../../rules/permission/channelHasZeroAdmins.js";
import { logger } from "../../logger.js";

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
      throw new Error("channelUniqueName is required");
    }

    // Set user data on context
    context.user = await setUserDataOnContext({
      context,
      getPermissionInfo: false,
    });

    const loggedInUsername = context.user?.username || null;

    if (!loggedInUsername) {
      throw new Error("User must be logged in");
    }

    // Check if the channel has zero admins
    const hasZeroAdmins = await channelHasZeroAdmins({
      channelName: channelUniqueName,
      context,
    });

    if (!hasZeroAdmins) {
      throw new Error("Cannot become admin: this forum already has one or more admins");
    }

    // Check if user is already an admin
    const currentChannel = await Channel.find({
      where: {
        uniqueName: channelUniqueName,
      },
      selectionSet: `{ 
        Admins {
          username
        }
      }`,
    });

    if (!currentChannel || !currentChannel[0]) {
      throw new Error("Channel not found");
    }

    const isAlreadyAdmin = currentChannel[0].Admins?.some(
      (admin: { username: string }) => admin.username === loggedInUsername
    );

    if (isAlreadyAdmin) {
      throw new Error("User is already an admin of this forum");
    }

    const addAdminInput: ChannelUpdateInput = {
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

    try {
      const result = await Channel.update({
        where: {
          uniqueName: channelUniqueName,
        },
        update: addAdminInput,
      });

      if (!result.channels[0]) {
        throw new Error("Failed to update channel admin");
      }

      return true;
    } catch (e) {
      logger.error("Error in becomeForumAdmin:", e);
      throw new Error("Failed to become forum admin");
    }
  };
};

export default getResolver;