import { updateEmoji } from "./updateEmoji.js";
import { assertDiscussionChannelEmojiEnabled } from "./channelPreferenceGuards.js";
const getResolver = (input) => {
    const { DiscussionChannel } = input;
    return async (parent, args, context, resolveInfo) => {
        const { discussionChannelId, emojiLabel, unicode, username } = args;
        if (!discussionChannelId || !emojiLabel || !unicode || !username) {
            throw new Error("All arguments (discussionChannelId, emojiLabel, unicode, username) are required");
        }
        try {
            const discussionChannel = await assertDiscussionChannelEmojiEnabled(DiscussionChannel, discussionChannelId);
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
        }
        catch (e) {
            console.error(e);
            throw e;
        }
    };
};
export default getResolver;
