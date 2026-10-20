import { updateEmoji } from "./updateEmoji.js";
import { assertDiscussionChannelEmojiEnabled } from "./channelPreferenceGuards.js";
import type { ReactionWriter } from "../../services/persistence/reactionWriter.js";
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
  reactionWriter: ReactionWriter;
};

const getResolver = (input: Input) => {
  const { reactionWriter } = input;
  return async (parent: unknown, args: Args, context: GraphQLContext, resolveInfo: GraphQLResolveInfo) => {
    const { discussionChannelId, emojiLabel, unicode, username } = args;

    if (!discussionChannelId || !emojiLabel || !unicode || !username) {
      throw new Error(
        "All arguments (discussionChannelId, emojiLabel, unicode, username) are required"
      );
    }

    try {
      const discussionChannel = await assertDiscussionChannelEmojiEnabled(
        context,
        discussionChannelId
      );
      const updatedEmojiJSON = updateEmoji(discussionChannel.emoji, {
        emojiLabel,
        unicode,
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

export default getResolver;
