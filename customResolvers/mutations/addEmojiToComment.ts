import { updateEmoji } from "./updateEmoji.js";
import { assertCommentEmojiEnabled } from "./channelPreferenceGuards.js";
import type { ReactionWriter } from "../../services/persistence/reactionWriter.js";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";
import { logger } from "../../logger.js";

type Args = {
  commentId: string;
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
    const { commentId, emojiLabel, unicode, username } = args;

    if (!commentId || !emojiLabel || !unicode || !username) {
      throw new Error(
        "All arguments (commentId, emojiLabel, unicode, username) are required"
      );
    }

    try {
      const comment = await assertCommentEmojiEnabled(context, commentId);
      const updatedEmojiJSON = updateEmoji(comment.emoji, {
        emojiLabel,
        unicode,
        username,
      });

      await reactionWriter.updateCommentEmoji(commentId, updatedEmojiJSON);

      return {
        id: commentId,
        emoji: updatedEmojiJSON,
      };
    } catch (e) {
      logger.error(e);
      throw e;
    }
  };
};

export default getResolver;
