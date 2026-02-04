import { parseUserMentions } from '../utils/userMentionParser.js';
import { createInAppNotification } from './notificationHelpers.js';

type MentionContextComment = {
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

type MentionContextDiscussion = {
  type: 'discussion';
  discussionId: string;
  title: string;
  channelUniqueName: string | null;
  authorUsername: string | null;
  authorLabel: string;
};

type MentionContext = MentionContextComment | MentionContextDiscussion;

type NotifyMentionsInput = {
  context: any;
  mentionContext: MentionContext;
  previousText?: string | null;
  nextText?: string | null;
};

export const getNewMentionUsernames = (
  previousText: string | null | undefined,
  nextText: string | null | undefined
): string[] => {
  const before = parseUserMentions(previousText || '').map(m => m.username);
  const after = parseUserMentions(nextText || '').map(m => m.username);

  if (!after.length) return [];

  const beforeSet = new Set(before.map(u => u.toLowerCase()));
  const newMentions: string[] = [];

  for (const username of after) {
    const key = username.toLowerCase();
    if (beforeSet.has(key)) continue;
    if (newMentions.some(existing => existing.toLowerCase() === key)) continue;
    newMentions.push(username);
  }

  return newMentions;
};

const resolveMentionedUsers = async (context: any, usernames: string[]): Promise<string[]> => {
  if (!usernames.length) return [];

  const normalized = Array.from(new Set(usernames.map(u => u.toLowerCase())));

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
    selectionSet: '{ username }'
  });

  return users.map((user: any) => user.username);
};

const buildNotificationText = (mentionContext: MentionContext, url: string | null): string | null => {
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
  nextText
}: NotifyMentionsInput): Promise<void> => {
  try {
    const newMentions = getNewMentionUsernames(previousText, nextText);
    if (!newMentions.length) return;

    const mentionedUsers = await resolveMentionedUsers(context, newMentions);
    if (!mentionedUsers.length) return;

    const mentionerUsername = mentionContext.authorUsername;
    const mentionerKey = mentionerUsername ? mentionerUsername.toLowerCase() : null;
    const usernamesToNotify = mentionerKey
      ? mentionedUsers.filter(username => username.toLowerCase() !== mentionerKey)
      : mentionedUsers;

    if (!usernamesToNotify.length) return;

    const notificationUrl = buildNotificationUrl(mentionContext);
    const notificationText = buildNotificationText(mentionContext, notificationUrl);
    if (!notificationText) return;

    const UserModel = context?.ogm?.model('User');
    if (!UserModel) return;

    for (const username of usernamesToNotify) {
      await createInAppNotification({
        UserModel,
        username,
        text: notificationText
      });
    }
  } catch (error) {
    console.error('Error sending user mention notifications:', error);
  }
};
