const emojiDisabledMessage = (channelName: string) =>
  `Emoji reactions are disabled in channel '${channelName}'.`;

const getEmojiEnabledFromChannel = (channel?: {
  uniqueName?: string;
  emojiEnabled?: boolean | null;
} | null) => {
  if (!channel?.uniqueName) {
    return null;
  }

  return {
    channelName: channel.uniqueName,
    emojiEnabled: channel.emojiEnabled !== false,
  };
};

export const assertDiscussionChannelEmojiEnabled = async (
  DiscussionChannel: any,
  discussionChannelId: string
) => {
  const discussionChannels = await DiscussionChannel.find({
    where: { id: discussionChannelId },
    selectionSet: `{
      id
      emoji
      channelUniqueName
      Channel {
        uniqueName
        emojiEnabled
      }
    }`,
  });

  const discussionChannel = discussionChannels?.[0];
  if (!discussionChannel) {
    throw new Error("DiscussionChannel not found");
  }

  const channelPreference = getEmojiEnabledFromChannel(
    discussionChannel.Channel
  ) || {
    channelName: discussionChannel.channelUniqueName,
    emojiEnabled: true,
  };

  if (!channelPreference.emojiEnabled) {
    throw new Error(emojiDisabledMessage(channelPreference.channelName));
  }

  return discussionChannel;
};

export const assertCommentEmojiEnabled = async (
  Comment: any,
  commentId: string
) => {
  const comments = await Comment.find({
    where: { id: commentId },
    selectionSet: `{
      id
      emoji
      Channel {
        uniqueName
        emojiEnabled
      }
      DiscussionChannel {
        channelUniqueName
        Channel {
          uniqueName
          emojiEnabled
        }
      }
    }`,
  });

  const comment = comments?.[0];
  if (!comment) {
    throw new Error("Comment not found");
  }

  const channelPreference =
    getEmojiEnabledFromChannel(comment.Channel) ||
    getEmojiEnabledFromChannel(comment.DiscussionChannel?.Channel) ||
    (comment.DiscussionChannel?.channelUniqueName
      ? {
          channelName: comment.DiscussionChannel.channelUniqueName,
          emojiEnabled: true,
        }
      : null);

  if (channelPreference?.emojiEnabled === false) {
    throw new Error(emojiDisabledMessage(channelPreference.channelName));
  }

  return comment;
};
