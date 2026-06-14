import { removeEmoji } from "./updateEmoji.js";
import { assertCommentEmojiEnabled } from "./channelPreferenceGuards.js";

type Input = {
  Comment: any;
};

type Args = {
  commentId: string;
  emojiLabel: string;
  username: string;
};

const getRemoveEmojiResolver = (input: Input) => {
  const { Comment } = input;
  return async (parent: any, args: Args, context: any, resolveInfo: any) => {
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
