import type { ChannelUpdateInput, ChannelModel } from "../../ogm_types.js";

type Args = {
  inviteeUsername: string;
  channelUniqueName: string;
};

type Input = {
  Channel: ChannelModel;
};

const getResolver = (input: Input) => {
  const { Channel } = input;
  return async (parent: any, args: Args, context: any, resolveInfo: any) => {
    const { channelUniqueName, inviteeUsername } = args;

    if (!channelUniqueName || !inviteeUsername) {
      throw new Error(
        "All arguments (channelUniqueName, inviteeUsername) are required"
      );
    }

    const channelUpdateInput: ChannelUpdateInput = {
      PendingOwnerInvites: [
        {
          disconnect: [
            {
              where: {
                node: {
                  username: inviteeUsername,
                },
              },
            },
          ],
        },
      ],
    };

    try {
      const result = await Channel.update({
        where: { uniqueName: channelUniqueName },
        update: channelUpdateInput,
      });
      if (!result.channels[0]) {
        throw new Error("Channel not found");
      }
      return true;
    } catch (e) {
      console.error("Error updating channel:", e);
      return false;
    }    
  };
};

export default getResolver;
