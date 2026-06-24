import { createInAppNotification } from './notificationHelpers.js';
import type { GraphQLContext } from '../types/context.js';

type FeedbackContext = {
  feedbackCommentId: string;
  authorUsername: string;
  authorDisplayName?: string;
  targetType: 'comment' | 'discussion' | 'event';
  targetId: string;
  channelUniqueName?: string;
  discussionId?: string;
  eventId?: string;
};

type NotifyFeedbackInput = {
  context: GraphQLContext;
  feedbackContext: FeedbackContext;
  targetAuthorUsername: string;
};

/**
 * Sends a notification when someone gives feedback on content.
 * The notification text does NOT include the feedback content for privacy.
 */
export const notifyFeedback = async ({
  context,
  feedbackContext,
  targetAuthorUsername,
}: NotifyFeedbackInput): Promise<void> => {
  try {
    const UserModel = context?.ogm?.model('User');
    if (!UserModel) {
      console.error('UserModel not available for feedback notification');
      return;
    }

    // Check if target author wants feedback notifications
    const users = await UserModel.find({
      where: { username: targetAuthorUsername },
      selectionSet: `{ username notifyOnFeedback }`,
    });

    if (!users.length) {
      return;
    }

    const targetUser = users[0];
    if (!targetUser.notifyOnFeedback) {
      // User has opted out of feedback notifications
      return;
    }

    // Don't notify yourself
    if (feedbackContext.authorUsername === targetAuthorUsername) {
      return;
    }

    const notificationUrl = buildFeedbackUrl(feedbackContext);
    const notificationText = buildFeedbackNotificationText(
      feedbackContext,
      notificationUrl
    );

    if (!notificationText) {
      return;
    }

    await createInAppNotification({
      UserModel,
      username: targetAuthorUsername,
      text: notificationText,
      notificationType: 'feedback',
    });
  } catch (error) {
    console.error('Error sending feedback notification:', error);
  }
};

function buildFeedbackUrl(feedbackContext: FeedbackContext): string | null {
  const baseUrl = process.env.FRONTEND_URL || '';

  if (feedbackContext.targetType === 'comment') {
    if (feedbackContext.channelUniqueName && feedbackContext.discussionId) {
      return `${baseUrl}/forums/${feedbackContext.channelUniqueName}/discussions/${feedbackContext.discussionId}/comments/${feedbackContext.targetId}`;
    }
    if (feedbackContext.channelUniqueName && feedbackContext.eventId) {
      return `${baseUrl}/forums/${feedbackContext.channelUniqueName}/events/${feedbackContext.eventId}/comments/${feedbackContext.targetId}`;
    }
  }

  if (feedbackContext.targetType === 'discussion') {
    if (feedbackContext.channelUniqueName) {
      return `${baseUrl}/forums/${feedbackContext.channelUniqueName}/discussions/${feedbackContext.targetId}`;
    }
  }

  if (feedbackContext.targetType === 'event') {
    if (feedbackContext.channelUniqueName) {
      return `${baseUrl}/forums/${feedbackContext.channelUniqueName}/events/${feedbackContext.targetId}`;
    }
  }

  return null;
}

function buildFeedbackNotificationText(
  feedbackContext: FeedbackContext,
  url: string | null
): string | null {
  // Privacy: DO NOT include feedback content in notification
  const targetLabel =
    feedbackContext.targetType === 'comment'
      ? 'comment'
      : feedbackContext.targetType === 'discussion'
        ? 'post'
        : 'event';

  if (url) {
    return `You received feedback on your [${targetLabel}](${url}).`;
  }

  return `You received feedback on your ${targetLabel}.`;
}
