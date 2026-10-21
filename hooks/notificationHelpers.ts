import type { Driver } from "neo4j-driver";
import { resolveNotificationWriter, type NotificationWriter } from "../services/persistence/notificationWriter.js";
import { logger } from "../logger.js";

export type CreateInAppNotificationInput = {
  context: {driver?: Driver; notificationWriter?: NotificationWriter};
  username: string;
  text: string;
  notificationType?: string; // "feedback", "mention", "reply", "moderation", "scratchpad", etc.
};

// Default for callers that don't specify a category. Notifications must always
// carry a notificationType: the General tab filters with NOT notificationType
// "feedback", and Neo4j three-valued logic excludes null-typed rows from that
// filter, so a null type would make the notification invisible in every tab
// while still counting toward the unread badge.
const DEFAULT_NOTIFICATION_TYPE = "general";

export const createInAppNotification = async ({
  context,
  username,
  text,
  notificationType = DEFAULT_NOTIFICATION_TYPE,
}: CreateInAppNotificationInput): Promise<boolean> => {
  try {
    return await resolveNotificationWriter(context).createForUser({username, text, notificationType});
  } catch (error) {
    logger.error('Error creating in-app notification:', error);
    return false;
  }
};
