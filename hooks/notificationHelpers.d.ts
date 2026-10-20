import type { Driver } from "neo4j-driver";
import type { NotificationWriter } from "../services/persistence/notificationWriter.js";

export type CreateInAppNotificationInput = {
  context: {driver?: Driver; notificationWriter?: NotificationWriter};
  username: string;
  text: string;
  notificationType?: string;
};
export function createInAppNotification(input: CreateInAppNotificationInput): Promise<boolean>;
