import type { ChannelUpdateInput, ChannelModel } from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";

type Args = {
  username: string;
  channelUniqueName: string;
};

type Input = {
  Channel: ChannelModel;
};

const getResolver = (input: Input) => {
  const { Channel } = input;
  return async (parent: unknown, args: Args, context: GraphQLContext, resolveInfo: GraphQLResolveInfo) => {
    const { channelUniqueName, username } = args;

    if (!channelUniqueName || !username) {
      throw new Error(
        "All arguments (channelUniqueName, username) are required"
      );
    }

    const channelUpdateInput: ChannelUpdateInput = {
      Admins: [
        {
          disconnect: [
            {
              where: {
                node: {
                  username: username,
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
