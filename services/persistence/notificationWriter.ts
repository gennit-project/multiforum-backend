import type { Driver } from "neo4j-driver";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";

export type NotificationInput = { username: string; text: string; notificationType: string };
export interface NotificationWriter {
  createForUser(input: NotificationInput): Promise<boolean>;
}

// Preserve the old OGM default projection, including fields the helper does not
// consume: serialization failures are part of its existing false-return contract.
// The production-schema parity test checks this against the actual OGM selection.
export const NOTIFICATION_USER_SELECTION = `{
  username displayName pronouns location bio profilePicURL
  avatar32Url avatar48Url avatar64Url avatar96Url
  enableSensitiveContentByDefault isBot botProfileId isDeprecated deprecatedReason
  commentKarma discussionKarma stripeAccountId defaultEmojiSkinTone preferredTimeZone
  deleted notifyOnReplyToCommentByDefault notifyOnReplyToDiscussionByDefault
  notifyOnReplyToEventByDefault notifyWhenTagged notifyOnSubscribedIssueUpdates
  notifyOnFeedback notifyOnSuspensionBlocks notificationBundleInterval
  notificationBundleEnabled notificationBundleContent variantUrls createdAt
}`;

const CREATE_NOTIFICATION = `mutation CreateInAppNotification($where: UserWhere, $update: UserUpdateInput) {
  updateUsers(where: $where, update: $update) { users ${NOTIFICATION_USER_SELECTION} }
}`;

export function createNotificationWriter(driver: Driver): NotificationWriter {
  return {
    async createForUser({ username, text, notificationType }) {
      // Generated mutation execution owns retries, defaults, relationship writes
      // and publication through the already-registered shared subscription engine.
      const result = await executeGeneratedOperation<{updateUsers: {users: unknown[]}}>(driver, CREATE_NOTIFICATION, {
        where: {username: {eq: username}},
        update: {Notifications: [{create: [{node: {text, read: false, notificationType}}]}]},
      });
      return Boolean(result.updateUsers?.users?.length);
    },
  };
}

export function resolveNotificationWriter(context: {
  driver?: Driver;
  notificationWriter?: NotificationWriter;
}): NotificationWriter {
  if (context.notificationWriter) return context.notificationWriter;
  if (!context.driver) throw new Error("Driver is required for notification creation");
  return createNotificationWriter(context.driver);
}
