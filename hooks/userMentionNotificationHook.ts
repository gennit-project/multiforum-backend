import { createInAppNotification } from './notificationHelpers.js';
import { getNewMentionUsernames } from '../utils/getNewMentionUsernames.js';
import {
  buildDiscussionMentionContext,
  MentionContextDiscussion,
  DiscussionSnapshot,
} from '../utils/buildDiscussionMentionContext.js';
import {
  buildCommentMentionContext,
  MentionContextComment,
  CommentSnapshot,
} from '../utils/buildCommentMentionContext.js';

// Re-export for consumers
export { getNewMentionUsernames } from '../utils/getNewMentionUsernames.js';
export {
  buildDiscussionMentionContext,
  MentionContextDiscussion,
  DiscussionSnapshot,
} from '../utils/buildDiscussionMentionContext.js';
export {
  buildCommentMentionContext,
  MentionContextComment,
  CommentSnapshot,
} from '../utils/buildCommentMentionContext.js';

type MentionContext = MentionContextComment | MentionContextDiscussion;

type NotifyMentionsInput = {
  context: any;
  mentionContext: MentionContext;
  previousText?: string | null;
  nextText?: string | null;
};

// High-level helper to notify discussion mentions
export const notifyDiscussionMentions = async ({
  context,
  discussion,
  previousText,
  nextText,
}: {
  context: any;
  discussion: DiscussionSnapshot;
  previousText?: string | null;
  nextText?: string | null;
}): Promise<void> => {
  const mentionContext = buildDiscussionMentionContext(discussion);
  await notifyNewUserMentions({
    context,
    mentionContext,
    previousText,
    nextText,
  });
};

// High-level helper to notify comment mentions
export const notifyCommentMentions = async ({
  context,
  comment,
  previousText,
  nextText,
}: {
  context: any;
  comment: CommentSnapshot;
  previousText?: string | null;
  nextText?: string | null;
}): Promise<void> => {
  const mentionContext = buildCommentMentionContext(comment);
  await notifyNewUserMentions({
    context,
    mentionContext,
    previousText,
    nextText,
  });
};

const resolveMentionedUsers = async (
  context: any,
  usernames: string[]
): Promise<string[]> => {
  if (!usernames.length) return [];

  const normalized = Array.from(new Set(usernames.map((u) => u.toLowerCase())));

  if (context?.driver) {
    const session = context.driver.session();
    try {
      const result = await session.run(
        'MATCH (u:User) WHERE toLower(u.username) IN $usernames RETURN u.username as username',
        { usernames: normalized }
      );
      return result.records.map((record: any) => record.get('username'));
    } finally {
      await session.close();
    }
  }

  const UserModel = context?.ogm?.model('User');
  if (!UserModel) return [];

  const users = await UserModel.find({
    where: { username_IN: usernames },
    selectionSet: '{ username }',
  });

  return users.map((user: any) => user.username);
};

const buildNotificationText = (
  mentionContext: MentionContext,
  url: string | null
): string | null => {
  if (mentionContext.type === 'comment') {
    if (mentionContext.discussion && url) {
      return `${mentionContext.authorLabel} mentioned you in a comment on [${mentionContext.discussion.title}](${url})`;
    }
    if (mentionContext.event && url) {
      return `${mentionContext.authorLabel} mentioned you in a comment on [${mentionContext.event.title}](${url})`;
    }
    return `${mentionContext.authorLabel} mentioned you in a comment`;
  }

  if (mentionContext.type === 'discussion') {
    if (mentionContext.title && url) {
      return `${mentionContext.authorLabel} mentioned you in [${mentionContext.title}](${url})`;
    }
    return `${mentionContext.authorLabel} mentioned you in a discussion`;
  }

  return null;
};

const buildNotificationUrl = (mentionContext: MentionContext): string | null => {
  if (mentionContext.type === 'comment') {
    if (mentionContext.discussion) {
      return `${process.env.FRONTEND_URL}/forums/${mentionContext.discussion.channelUniqueName}/discussions/${mentionContext.discussion.id}/comments/${mentionContext.commentId}`;
    }
    if (mentionContext.event) {
      return `${process.env.FRONTEND_URL}/forums/${mentionContext.event.channelUniqueName}/events/${mentionContext.event.id}/comments/${mentionContext.commentId}`;
    }
    return null;
  }

  if (mentionContext.type === 'discussion') {
    if (!mentionContext.channelUniqueName) return null;
    return `${process.env.FRONTEND_URL}/forums/${mentionContext.channelUniqueName}/discussions/${mentionContext.discussionId}`;
  }

  return null;
};

export const notifyNewUserMentions = async ({
  context,
  mentionContext,
  previousText,
  nextText,
}: NotifyMentionsInput): Promise<void> => {
  try {
    const newMentions = getNewMentionUsernames(previousText, nextText);
    if (!newMentions.length) return;

    const mentionedUsers = await resolveMentionedUsers(context, newMentions);
    if (!mentionedUsers.length) return;

    const mentionerUsername = mentionContext.authorUsername;
    const mentionerKey = mentionerUsername
      ? mentionerUsername.toLowerCase()
      : null;
    const usernamesToNotify = mentionerKey
      ? mentionedUsers.filter(
          (username) => username.toLowerCase() !== mentionerKey
        )
      : mentionedUsers;

    if (!usernamesToNotify.length) return;

    const notificationUrl = buildNotificationUrl(mentionContext);
    const notificationText = buildNotificationText(
      mentionContext,
      notificationUrl
    );
    if (!notificationText) return;

    const UserModel = context?.ogm?.model('User');
    if (!UserModel) return;

    for (const username of usernamesToNotify) {
      await createInAppNotification({
        UserModel,
        username,
        text: notificationText,
      });
    }
  } catch (error) {
    console.error('Error sending user mention notifications:', error);
  }
};
