import { removeEmoji } from "./updateEmoji.js";
import { assertDiscussionChannelEmojiEnabled } from "./channelPreferenceGuards.js";

type Input = {
  DiscussionChannel: any;
};

type Args = {
  discussionChannelId: string;
  emojiLabel: string;
  username: string;
};

const getRemoveEmojiResolver = (input: Input) => {
  const { DiscussionChannel } = input;
  return async (parent: any, args: Args, context: any, resolveInfo: any) => {
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
