import type { ChannelUpdateInput, UserModel, ChannelModel } from "../../ts_emitted/ogm-types";

type Args = {
  username: string;
  channelUniqueName: string;
};

type Input = {
  Channel: ChannelModel;
  User: UserModel;
};

const getResolver = (input: Input) => {
  const { Channel, User } = input;
  return async (parent: any, args: Args, context: any, resolveInfo: any) => {
    const { channelUniqueName, username } = args;

    if (!channelUniqueName || !username) {
      throw new Error(
        "All arguments (channelUniqueName, username) are required"
      );
    }
    // get mod name from username
    const userData = await User.find({
      where: {
        username
      },
      selectionSet: `{
        ModerationProfile {
          displayName
        }
      }`
    })
    const displayName = userData[0]?.ModerationProfile?.displayName || null;
    if (!displayName) {
      throw new Error(`User ${username} is not a moderator`);
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
      console.error(e);
      return false;
    }
  };
};

export default getResolver;
