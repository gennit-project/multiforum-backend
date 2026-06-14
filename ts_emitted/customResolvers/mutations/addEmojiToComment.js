import { updateEmoji } from "./updateEmoji.js";
import { assertCommentEmojiEnabled } from "./channelPreferenceGuards.js";
const getResolver = (input) => {
    const { Comment } = input;
    return async (parent, args, context, resolveInfo) => {
        const { commentId, emojiLabel, unicode, username } = args;
        if (!commentId || !emojiLabel || !unicode || !username) {
            throw new Error("All arguments (commentId, emojiLabel, unicode, username) are required");
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
        }
        catch (e) {
            console.error(e);
            throw e;
        }
    };
};
export default getResolver;
