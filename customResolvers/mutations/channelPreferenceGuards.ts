import type { CommentModel, DiscussionChannelModel } from "../../ogm_types.js";

const emojiDisabledMessage = (channelName: string) =>
  `Emoji reactions are disabled in channel '${channelName}'.`;

// Locked/archived content is frozen: no emoji reactions can be added or
// removed. Throws with a clear reason when the target (or its discussion) is
// locked or archived.
const assertNotLockedOrArchived = (
  entity: { locked?: boolean | null; archived?: boolean | null } | null | undefined,
  label: string
) => {
  if (entity?.locked) {
    throw new Error(`Emoji reactions are disabled because this ${label} is locked.`);
  }
  if (entity?.archived) {
    throw new Error(`Emoji reactions are disabled because this ${label} is archived.`);
  }
};

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
  DiscussionChannel: DiscussionChannelModel,
  discussionChannelId: string
) => {
  const discussionChannels = await DiscussionChannel.find({
    where: { id: discussionChannelId },
    selectionSet: `{
      id
      emoji
      locked
      archived
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

  assertNotLockedOrArchived(discussionChannel, "discussion");

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
  Comment: CommentModel,
  commentId: string
) => {
  const comments = await Comment.find({
    where: { id: commentId },
    selectionSet: `{
      id
      emoji
      archived
      Channel {
        uniqueName
        emojiEnabled
      }
      DiscussionChannel {
        channelUniqueName
        locked
        archived
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

  // The comment itself can be archived, and the discussion it lives under can
  // be locked or archived — any of these freezes reactions on the comment.
  assertNotLockedOrArchived(comment, "comment");
  assertNotLockedOrArchived(comment.DiscussionChannel, "discussion");

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
