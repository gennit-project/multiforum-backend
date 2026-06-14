import { removeEmoji } from "./updateEmoji.js";
import { assertCommentEmojiEnabled } from "./channelPreferenceGuards.js";
const getRemoveEmojiResolver = (input) => {
    const { Comment } = input;
    return async (parent, args, context, resolveInfo) => {
        const { commentId, emojiLabel, username } = args;
        if (!commentId || !emojiLabel || !username) {
            throw new Error("All arguments (commentId, emojiLabel, username) are required");
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
        }
        catch (e) {
            console.error(e);
            throw e;
        }
    };
};
export default getRemoveEmojiResolver;
