import { createInAppNotification } from './notificationHelpers.js';

// Regex to match /m/modProfileName mentions
const MOD_MENTION_REGEX = /\/m\/([a-zA-Z0-9_-]+)/g;

type ModMentionContext = {
  type: 'comment' | 'discussion' | 'issue';
  authorUsername: string;
  authorLabel: string;
  commentId?: string;
  discussionId?: string;
  discussionTitle?: string;
  issueId?: string;
  issueNumber?: number;
  channelUniqueName?: string;
  eventId?: string;
  eventTitle?: string;
};

type NotifyModMentionsInput = {
  context: any;
  mentionContext: ModMentionContext;
  previousText?: string | null;
  nextText?: string | null;
};

/**
 * Extract mod profile names from text using /m/modProfileName syntax
 */
export const extractModMentions = (text: string | null | undefined): string[] => {
  if (!text) return [];
  const matches = text.matchAll(MOD_MENTION_REGEX);
  return Array.from(matches, (m) => m[1]);
};

/**
 * Get new mod mentions that weren't in the previous text
 */
export const getNewModMentions = (
  previousText: string | null | undefined,
  nextText: string | null | undefined
): string[] => {
  const previousMentions = new Set(
    extractModMentions(previousText).map((m) => m.toLowerCase())
  );
  const nextMentions = extractModMentions(nextText);

  return nextMentions.filter(
    (mention) => !previousMentions.has(mention.toLowerCase())
  );
};

/**
 * Resolve mod profile names to their associated user accounts
 */
const resolveModProfiles = async (
  context: any,
  modProfileNames: string[]
): Promise<Array<{ displayName: string; username: string; notifyWhenTagged: boolean }>> => {
  if (!modProfileNames.length) return [];

  const driver = context?.driver;
  if (!driver) return [];

  const session = driver.session();
  try {
    const result = await session.run(
      `
      MATCH (mp:ModerationProfile)-[:MODERATION_PROFILE_OF]->(u:User)
      WHERE mp.displayName IN $modProfileNames
      RETURN mp.displayName as displayName, u.username as username, u.notifyWhenTagged as notifyWhenTagged
      `,
      { modProfileNames }
    );

    return result.records.map((record: any) => ({
      displayName: record.get('displayName'),
      username: record.get('username'),
      notifyWhenTagged: Boolean(record.get('notifyWhenTagged')),
    }));
  } finally {
    await session.close();
  }
};

/**
 * Build the notification URL based on context
 */
const buildNotificationUrl = (mentionContext: ModMentionContext): string | null => {
  const baseUrl = process.env.FRONTEND_URL || '';

  if (mentionContext.type === 'comment') {
    if (mentionContext.discussionId && mentionContext.channelUniqueName) {
      return `${baseUrl}/forums/${mentionContext.channelUniqueName}/discussions/${mentionContext.discussionId}/comments/${mentionContext.commentId}`;
    }
    if (mentionContext.eventId && mentionContext.channelUniqueName) {
      return `${baseUrl}/forums/${mentionContext.channelUniqueName}/events/${mentionContext.eventId}/comments/${mentionContext.commentId}`;
    }
    if (mentionContext.issueId && mentionContext.channelUniqueName) {
      return `${baseUrl}/forums/${mentionContext.channelUniqueName}/issues/${mentionContext.issueNumber}`;
    }
  }

  if (mentionContext.type === 'discussion') {
    if (mentionContext.channelUniqueName) {
      return `${baseUrl}/forums/${mentionContext.channelUniqueName}/discussions/${mentionContext.discussionId}`;
    }
  }

  if (mentionContext.type === 'issue') {
    if (mentionContext.channelUniqueName && mentionContext.issueNumber) {
      return `${baseUrl}/forums/${mentionContext.channelUniqueName}/issues/${mentionContext.issueNumber}`;
    }
  }

  return null;
};

/**
 * Build the notification text
 */
const buildNotificationText = (
  mentionContext: ModMentionContext,
  url: string | null
): string | null => {
  const { authorLabel } = mentionContext;

  if (mentionContext.type === 'comment') {
    const title =
      mentionContext.discussionTitle ||
      mentionContext.eventTitle ||
      (mentionContext.issueNumber ? `Issue #${mentionContext.issueNumber}` : null);

    if (title && url) {
      return `${authorLabel} mentioned you as a moderator in a comment on [${title}](${url})`;
    }
    return `${authorLabel} mentioned you as a moderator in a comment`;
  }

  if (mentionContext.type === 'discussion') {
    if (mentionContext.discussionTitle && url) {
      return `${authorLabel} mentioned you as a moderator in [${mentionContext.discussionTitle}](${url})`;
    }
    return `${authorLabel} mentioned you as a moderator in a discussion`;
  }

  if (mentionContext.type === 'issue') {
    if (mentionContext.issueNumber && url) {
      return `${authorLabel} mentioned you as a moderator in [Issue #${mentionContext.issueNumber}](${url})`;
    }
    return `${authorLabel} mentioned you as a moderator in an issue`;
  }

  return null;
};

/**
 * Notify moderators who were mentioned using /m/modProfileName syntax
 */
export const notifyModMentions = async ({
  context,
  mentionContext,
  previousText,
  nextText,
}: NotifyModMentionsInput): Promise<void> => {
  try {
    const newMentions = getNewModMentions(previousText, nextText);
    if (!newMentions.length) return;

    const modProfiles = await resolveModProfiles(context, newMentions);
    if (!modProfiles.length) return;

    // Filter out the author (don't notify yourself)
    const mentionerKey = mentionContext.authorUsername?.toLowerCase();
    const modsToNotify = mentionerKey
      ? modProfiles.filter((mp) => mp.username.toLowerCase() !== mentionerKey)
      : modProfiles;

    if (!modsToNotify.length) return;

    const notificationUrl = buildNotificationUrl(mentionContext);
    const notificationText = buildNotificationText(mentionContext, notificationUrl);
    if (!notificationText) return;

    const UserModel = context?.ogm?.model('User');
    if (!UserModel) return;

    for (const mod of modsToNotify) {
      await createInAppNotification({
        UserModel,
        username: mod.username,
        text: notificationText,
        notificationType: 'mention',
      });
    }
  } catch (error) {
    console.error('Error sending mod mention notifications:', error);
  }
};
