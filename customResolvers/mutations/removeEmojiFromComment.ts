import { removeEmoji } from "./updateEmoji.js";
import { assertCommentEmojiEnabled } from "./channelPreferenceGuards.js";
import type { CommentModel } from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";

type Input = {
  Comment: CommentModel;
};

type Args = {
  commentId: string;
  emojiLabel: string;
  username: string;
};

const getRemoveEmojiResolver = (input: Input) => {
  const { Comment } = input;
  return async (parent: unknown, args: Args, context: GraphQLContext, resolveInfo: GraphQLResolveInfo) => {
    const { commentId, emojiLabel, username } = args;

    if (!commentId || !emojiLabel || !username) {
      throw new Error(
        "All arguments (commentId, emojiLabel, username) are required"
      );
    }

    try {
      const comment = await assertCommentEmojiEnabled(Comment, commentId);
      const updatedEmojiJSON = removeEmoji(comment.emoji, {
        emojiLabel,
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

export default getRemoveEmojiResolver;
