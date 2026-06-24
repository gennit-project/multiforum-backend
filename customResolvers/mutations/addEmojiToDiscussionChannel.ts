import { updateEmoji } from "./updateEmoji.js";
import { assertDiscussionChannelEmojiEnabled } from "./channelPreferenceGuards.js";
import type { DiscussionChannelModel } from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";
import { logger } from "../../logger.js";

type Args = {
  discussionChannelId: string;
  emojiLabel: string;
  unicode: string;
  username: string;
};

type Input = {
  DiscussionChannel: DiscussionChannelModel;
};

const getResolver = (input: Input) => {
  const { DiscussionChannel } = input;
  return async (parent: unknown, args: Args, context: GraphQLContext, resolveInfo: GraphQLResolveInfo) => {
    const { discussionChannelId, emojiLabel, unicode, username } = args;

    if (!discussionChannelId || !emojiLabel || !unicode || !username) {
      throw new Error(
        "All arguments (discussionChannelId, emojiLabel, unicode, username) are required"
      );
    }

    try {
      const discussionChannel = await assertDiscussionChannelEmojiEnabled(
        DiscussionChannel,
        discussionChannelId
      );
      const updatedEmojiJSON = updateEmoji(discussionChannel.emoji, {
        emojiLabel,
        unicode,
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
      logger.error(e);
      throw e;
    }
  };
};

export default getResolver;
