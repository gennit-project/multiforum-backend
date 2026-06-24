import { updateEmoji } from "./updateEmoji.js";
import { assertCommentEmojiEnabled } from "./channelPreferenceGuards.js";
import type { CommentModel } from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";

type Args = {
  commentId: string;
  emojiLabel: string;
  unicode: string;
  username: string;
};

type Input = {
  Comment: CommentModel;
};

const getResolver = (input: Input) => {
  const { Comment } = input;
  return async (parent: unknown, args: Args, context: GraphQLContext, resolveInfo: GraphQLResolveInfo) => {
    const { commentId, emojiLabel, unicode, username } = args;

    if (!commentId || !emojiLabel || !unicode || !username) {
      throw new Error(
        "All arguments (commentId, emojiLabel, unicode, username) are required"
      );
    }

    try {
      const comment = await assertCommentEmojiEnabled(Comment, commentId);
      const updatedEmojiJSON = updateEmoji(comment.emoji, {
        emojiLabel,
        unicode,
        username,
      });

      await Comment.update({
        where: {
          id: commentId,
        },
        update: {
          emoji: updatedEmojiJSON,
        },
      });

      return {
        id: commentId,
        emoji: updatedEmojiJSON,
      };
    } catch (e) {
      console.error(e);
      throw e;
    }
  };
};

export default getResolver;
