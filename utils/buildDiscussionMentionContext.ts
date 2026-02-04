export type DiscussionSnapshot = {
  id: string;
  title?: string | null;
  body?: string | null;
  Author?: {
    username?: string | null;
    displayName?: string | null;
  } | null;
  DiscussionChannels?: Array<{
    channelUniqueName?: string | null;
  }> | null;
};

export type MentionContextDiscussion = {
  type: 'discussion';
  discussionId: string;
  title: string;
  channelUniqueName: string | null;
  authorUsername: string | null;
  authorLabel: string;
};

/**
 * Builds a mention context object from a discussion snapshot.
 * Extracts author info and channel for use in mention notifications.
 */
export const buildDiscussionMentionContext = (
  discussion: DiscussionSnapshot
): MentionContextDiscussion => {
  const authorUsername = discussion.Author?.username || null;
  const authorLabel =
    discussion.Author?.displayName || authorUsername || 'Someone';
  const channelUniqueName =
    discussion.DiscussionChannels?.[0]?.channelUniqueName || null;

  return {
    type: 'discussion',
    discussionId: discussion.id,
    title: discussion.title || 'discussion',
    channelUniqueName,
    authorUsername,
    authorLabel,
  };
};
