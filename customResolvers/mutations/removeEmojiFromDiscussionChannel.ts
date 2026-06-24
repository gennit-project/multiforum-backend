import { removeEmoji } from "./updateEmoji.js";
import { assertDiscussionChannelEmojiEnabled } from "./channelPreferenceGuards.js";
import type { DiscussionChannelModel } from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";

type Input = {
  DiscussionChannel: DiscussionChannelModel;
};

type Args = {
  discussionChannelId: string;
  emojiLabel: string;
  username: string;
};

const getRemoveEmojiResolver = (input: Input) => {
  const { DiscussionChannel } = input;
  return async (parent: unknown, args: Args, context: GraphQLContext, resolveInfo: GraphQLResolveInfo) => {
    const { discussionChannelId, emojiLabel, username } = args;

    if (!discussionChannelId || !emojiLabel || !username) {
      throw new Error(
        "All arguments (discussionChannelId, emojiLabel, username) are required"
      );
    }

    try {
      const discussionChannel = await assertDiscussionChannelEmojiEnabled(
        DiscussionChannel,
        discussionChannelId
      );
      const updatedEmojiJSON = removeEmoji(discussionChannel.emoji, {
        emojiLabel,
        username,
      });

      await DiscussionChannel.update({
        where: {
          id: discussionChannelId,
        },
        update: {
          emoji: updatedEmojiJSON,
        },
      });

      return {
        id: discussionChannelId,
        emoji: updatedEmojiJSON,
      };
    } catch (e) {
      console.error(e);
      throw e;
    }
  };
};

export default getRemoveEmojiResolver;
