import { createInAppNotification } from './notificationHelpers.js';
import { getNewMentionUsernames } from '../utils/getNewMentionUsernames.js';
import { sendEmail } from '../services/mail/index.js';
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
import { createCommentMentionNotificationEmail } from '../customResolvers/mutations/shared/emailUtils.js';

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
  dependencies?: {
    createInAppNotification?: typeof createInAppNotification;
    sendEmail?: typeof sendEmail;
    createCommentMentionNotificationEmail?: typeof createCommentMentionNotificationEmail;
  };
};

type MentionedUser = {
  username: string;
  notifyWhenTagged: boolean;
  email: string | null;
};

// High-level helper to notify discussion mentions
export const notifyDiscussionMentions = async ({
  context,
  discussion,
  previousText,
  nextText,
  dependencies,
}: {
  context: any;
  discussion: DiscussionSnapshot;
  previousText?: string | null;
  nextText?: string | null;
  dependencies?: NotifyMentionsInput["dependencies"];
}): Promise<void> => {
  const mentionContext = buildDiscussionMentionContext(discussion);
  await notifyNewUserMentions({
    context,
    mentionContext,
    previousText,
    nextText,
    dependencies,
  });
};

// High-level helper to notify comment mentions
export const notifyCommentMentions = async ({
  context,
  comment,
  previousText,
  nextText,
  dependencies,
}: {
  context: any;
  comment: CommentSnapshot;
  previousText?: string | null;
  nextText?: string | null;
  dependencies?: NotifyMentionsInput["dependencies"];
}): Promise<void> => {
  const mentionContext = buildCommentMentionContext(comment);
  await notifyNewUserMentions({
    context,
    mentionContext,
    previousText,
    nextText,
    dependencies,
  });
};

const resolveMentionedUsers = async (
  context: any,
  usernames: string[]
): Promise<MentionedUser[]> => {
  if (!usernames.length) return [];

  const normalized = Array.from(new Set(usernames.map((u) => u.toLowerCase())));

  const UserModel = context?.ogm?.model('User');
  if (UserModel) {
    const users = await UserModel.find({
      where: { username_IN: usernames },
      selectionSet: `{
        username
        notifyWhenTagged
        Email {
          address
        }
      }`,
    });

    return users.map((user: any) => ({
      username: user.username,
      notifyWhenTagged: Boolean(user.notifyWhenTagged),
      email: user.Email?.address || null,
    }));
  }

  if (context?.driver) {
    const session = context.driver.session();
    try {
      const result = await session.run(
        `
        MATCH (u:User)
        WHERE toLower(u.username) IN $usernames
        OPTIONAL MATCH (u)-[:HAS_EMAIL]->(email:Email)
        RETURN u.username as username, u.notifyWhenTagged as notifyWhenTagged, email.address as email
        `,
        { usernames: normalized }
      );
      return result.records.map((record: any) => ({
        username: record.get('username'),
        notifyWhenTagged: Boolean(record.get('notifyWhenTagged')),
        email: record.get('email') || null,
      }));
    } finally {
      await session.close();
    }
  }
  return [];
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
  dependencies,
}: NotifyMentionsInput): Promise<void> => {
  try {
    const createInAppNotificationFn =
      dependencies?.createInAppNotification || createInAppNotification;
    const sendEmailFn = dependencies?.sendEmail || sendEmail;
    const createCommentMentionNotificationEmailFn =
      dependencies?.createCommentMentionNotificationEmail ||
      createCommentMentionNotificationEmail;
    const newMentions = getNewMentionUsernames(previousText, nextText);
    if (!newMentions.length) return;

    const mentionedUsers = await resolveMentionedUsers(context, newMentions);
    if (!mentionedUsers.length) return;

    const mentionerUsername = mentionContext.authorUsername;
    const mentionerKey = mentionerUsername
      ? mentionerUsername.toLowerCase()
      : null;
    const usersToNotify = mentionerKey
      ? mentionedUsers.filter(
          (user) => user.username.toLowerCase() !== mentionerKey
        )
      : mentionedUsers;

    if (!usersToNotify.length) return;

    const notificationUrl = buildNotificationUrl(mentionContext);
    const notificationText = buildNotificationText(
      mentionContext,
      notificationUrl
    );
    if (!notificationText) return;

    const UserModel = context?.ogm?.model('User');
    if (!UserModel) return;

    for (const user of usersToNotify) {
      await createInAppNotificationFn({
        UserModel,
        username: user.username,
        text: notificationText,
      });

      if (
        mentionContext.type === 'comment' &&
        notificationUrl &&
        user.notifyWhenTagged &&
        user.email
      ) {
        const contentTitle = mentionContext.event?.title || mentionContext.discussion?.title || 'discussion';
        const emailContent = createCommentMentionNotificationEmailFn(
          mentionContext.authorLabel,
          contentTitle,
          notificationUrl,
          Boolean(mentionContext.event)
        );

        await sendEmailFn({
          to: user.email,
          subject: emailContent.subject,
          text: emailContent.plainText,
          html: emailContent.html,
        });
      }
    }
  } catch (error) {
    console.error('Error sending user mention notifications:', error);
  }
};
