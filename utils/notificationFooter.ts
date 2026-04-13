/**
 * Notification Footer Utility
 *
 * Generates consistent footer text for notifications with unsubscribe links.
 * The footer explains why the user received the notification and provides
 * a one-click unsubscribe option.
 */

export type SubscriptionReason = 'default' | 'subscribed';

export type NotificationFooterParams = {
  /** Type of content the notification is about */
  contentType: 'discussion' | 'event' | 'comment' | 'issue';
  /** URL to the content page (will have ?action=unsubscribe appended) */
  contentUrl: string;
  /** Why the user received this notification */
  reason?: SubscriptionReason;
};

/**
 * Builds the unsubscribe URL by appending ?action=unsubscribe
 */
export function buildUnsubscribeUrl(contentUrl: string): string {
  if (!contentUrl) return '';

  // Handle URLs that already have query params
  const separator = contentUrl.includes('?') ? '&' : '?';
  return `${contentUrl}${separator}action=unsubscribe`;
}

/**
 * Gets the label for the content type
 */
function getContentTypeLabel(contentType: NotificationFooterParams['contentType']): string {
  switch (contentType) {
    case 'discussion':
      return 'this discussion';
    case 'event':
      return 'this event';
    case 'comment':
      return 'this comment';
    case 'issue':
      return 'this issue';
    default:
      return 'this content';
  }
}

/**
 * Gets the reason text for why the user received the notification
 */
function getReasonText(
  reason: SubscriptionReason,
  contentType: NotificationFooterParams['contentType']
): string {
  if (reason === 'default') {
    return 'you are subscribed by default';
  }
  return `you are subscribed to ${getContentTypeLabel(contentType)}`;
}

/**
 * Builds the notification footer markdown with unsubscribe link
 *
 * Example output:
 * ```
 *
 * ---
 * You received this because you are subscribed to this discussion.
 * [Notification settings](/account_settings#notifications) | [Unsubscribe](/forums/channel/discussions/id?action=unsubscribe)
 * ```
 */
export function buildNotificationFooter(params: NotificationFooterParams): string {
  const { contentType, contentUrl, reason = 'subscribed' } = params;
  const baseUrl = process.env.FRONTEND_URL || '';

  const reasonText = getReasonText(reason, contentType);
  const unsubscribeUrl = buildUnsubscribeUrl(contentUrl);
  const settingsUrl = `${baseUrl}/account_settings#notifications`;

  // Use double newline before --- to ensure markdown renders correctly
  return `

---
You received this because ${reasonText}.
[Notification settings](${settingsUrl}) | [Unsubscribe](${unsubscribeUrl})`;
}

/**
 * Appends the notification footer to existing notification text
 */
export function appendNotificationFooter(
  notificationText: string,
  params: NotificationFooterParams
): string {
  const footer = buildNotificationFooter(params);
  return `${notificationText}${footer}`;
}
