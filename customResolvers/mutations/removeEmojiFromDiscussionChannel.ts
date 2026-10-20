import { removeEmoji } from "./updateEmoji.js";
import { assertDiscussionChannelEmojiEnabled } from "./channelPreferenceGuards.js";
import type { ReactionWriter } from "../../services/persistence/reactionWriter.js";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";
import { logger } from "../../logger.js";

type Input = {
  reactionWriter: ReactionWriter;
};

type Args = {
  discussionChannelId: string;
  emojiLabel: string;
  username: string;
};

const getRemoveEmojiResolver = (input: Input) => {
  const { reactionWriter } = input;
  return async (parent: unknown, args: Args, context: GraphQLContext, resolveInfo: GraphQLResolveInfo) => {
    const { discussionChannelId, emojiLabel, username } = args;

    if (!discussionChannelId || !emojiLabel || !username) {
      throw new Error(
        "All arguments (discussionChannelId, emojiLabel, username) are required"
      );
    }

    try {
      const discussionChannel = await assertDiscussionChannelEmojiEnabled(
        context,
        discussionChannelId
      );
      const updatedEmojiJSON = removeEmoji(discussionChannel.emoji, {
        emojiLabel,
        username,
      });

      await reactionWriter.updateDiscussionChannelEmoji(discussionChannelId, updatedEmojiJSON);

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

export default getRemoveEmojiResolver;
