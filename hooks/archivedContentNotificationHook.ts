import { createInAppNotification } from './notificationHelpers.js';

type ContentType = 'comment' | 'discussion' | 'event' | 'image';

type ArchivedContentNotificationParams = {
  /** OGM context with models */
  context: {
    ogm: any;
    driver?: any;
  };
  /** Type of content that was archived */
  contentType: ContentType;
  /** Username of the content author */
  authorUsername: string;
  /** URL to the archived content (for the notification link) */
  contentUrl: string;
  /** Channel where the content exists */
  channelUniqueName: string;
  /** Issue number for the related moderation issue */
  issueNumber: number;
  /** Username of the moderator who archived the content */
  moderatorUsername?: string;
};

/**
 * Get the content type label for user-facing text
 */
function getContentTypeLabel(contentType: ContentType): string {
  switch (contentType) {
    case 'comment':
      return 'comment';
    case 'discussion':
      return 'post';
    case 'event':
      return 'event';
    case 'image':
      return 'image';
    default:
      return 'content';
  }
}

/**
 * Build the notification text for archived content
 * Includes information about how to appeal
 */
function buildArchivedContentNotificationText(params: {
  contentType: ContentType;
  contentUrl: string;
  channelUniqueName: string;
  issueNumber: number;
}): string {
  const { contentType, contentUrl, channelUniqueName, issueNumber } = params;
  const baseUrl = process.env.FRONTEND_URL || '';
  const contentLabel = getContentTypeLabel(contentType);
  const issueUrl = `${baseUrl}/forums/${channelUniqueName}/issues/${issueNumber}`;
  const supportEmail = process.env.SUPPORT_EMAIL || 'support@example.com';

  // Build notification with appeal instructions
  return `Your [${contentLabel}](${contentUrl}) was archived for violating community guidelines.

You can request a review by commenting on [Issue #${issueNumber}](${issueUrl}). If you need additional help, contact ${supportEmail}.`;
}

/**
 * Notify the content author when their content is archived
 *
 * This sends a notification to the author with:
 * - Link to their archived content
 * - Link to the related issue where they can appeal
 * - Support contact information
 */
export async function notifyArchivedContentAuthor(
  params: ArchivedContentNotificationParams
): Promise<boolean> {
  const {
    context,
    contentType,
    authorUsername,
    contentUrl,
    channelUniqueName,
    issueNumber,
    moderatorUsername,
  } = params;

  try {
    // Don't notify if the author is the moderator (self-archival)
    if (moderatorUsername && authorUsername === moderatorUsername) {
      return false;
    }

    const UserModel = context.ogm?.model('User');
    if (!UserModel) {
      console.error('UserModel not available for archived content notification');
      return false;
    }

    // Check if user exists and wants notifications
    const users = await UserModel.find({
      where: { username: authorUsername },
      selectionSet: `{ username }`,
    });

    if (!users.length) {
      return false;
    }

    const notificationText = buildArchivedContentNotificationText({
      contentType,
      contentUrl,
      channelUniqueName,
      issueNumber,
    });

    return await createInAppNotification({
      UserModel,
      username: authorUsername,
      text: notificationText,
      notificationType: 'moderation',
    });
  } catch (error) {
    console.error('Error sending archived content notification:', error);
    return false;
  }
}
