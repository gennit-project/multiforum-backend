export type CommentSnapshot = {
  id: string;
  text?: string | null;
  CommentAuthor?: {
    username?: string | null;
    displayName?: string | null;
    User?: {
      username?: string | null;
    } | null;
  } | null;
  DiscussionChannel?: {
    discussionId?: string | null;
    channelUniqueName?: string | null;
    Discussion?: {
      id?: string | null;
      title?: string | null;
    } | null;
  } | null;
  Event?: {
    id?: string | null;
    title?: string | null;
    EventChannels?: Array<{
      channelUniqueName?: string | null;
    }> | null;
  } | null;
};

export type MentionContextComment = {
  type: 'comment';
  commentId: string;
  authorUsername: string | null;
  authorLabel: string;
  discussion?: {
    id: string;
    title: string;
    channelUniqueName: string;
  } | null;
  event?: {
    id: string;
    title: string;
    channelUniqueName: string;
  } | null;
};

/**
 * Builds a mention context object from a comment snapshot.
 * Extracts author info and discussion/event context for use in mention notifications.
 */
export const buildCommentMentionContext = (
  comment: CommentSnapshot
): MentionContextComment => {
  const authorUsername =
    comment.CommentAuthor?.username ||
    comment.CommentAuthor?.User?.username ||
    null;
  const authorLabel =
    comment.CommentAuthor?.displayName || authorUsername || 'Someone';

  const discussionContext = comment.DiscussionChannel?.discussionId
    ? {
        id: comment.DiscussionChannel.discussionId,
        title: comment.DiscussionChannel.Discussion?.title || 'discussion',
        channelUniqueName: comment.DiscussionChannel.channelUniqueName!,
      }
    : null;

  const eventChannelUniqueName =
    comment.Event?.EventChannels?.[0]?.channelUniqueName || null;
  const eventContext =
    comment.Event?.id && eventChannelUniqueName
      ? {
          id: comment.Event.id,
          title: comment.Event.title || 'event',
          channelUniqueName: eventChannelUniqueName,
        }
      : null;

  return {
    type: 'comment',
    commentId: comment.id,
    authorUsername,
    authorLabel,
    discussion: discussionContext,
    event: eventContext,
  };
};
