import type { Driver } from "neo4j-driver";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import { NOTIFICATION_USER_SELECTION } from "./notificationWriter.js";

export interface EmailNotificationRepository {
  findRecipient(username: string): Promise<Array<{username: string; Email?: {address: string} | null}>>;
  createAfterEmailNotification(username: string, text: string): Promise<boolean>;
}
const EMAIL_RECIPIENT = `query EmailNotificationRecipient($where: UserWhere) {
  users(where: $where) { username Email { address } }
}`;
const AFTER_EMAIL_NOTIFICATION = `mutation CreateAfterEmailNotification($where: UserWhere, $update: UserUpdateInput) {
  updateUsers(where: $where, update: $update) { users ${NOTIFICATION_USER_SELECTION} }
}`;
export function createEmailNotificationRepository(driver: Driver): EmailNotificationRepository {
  return {
    async findRecipient(username) {
      const result = await executeGeneratedOperation<{users: Array<{username: string; Email?: {address: string} | null}>}>(
        driver, EMAIL_RECIPIENT, {where: {username: {eq: username}}}
      );
      return result.users;
    },
    async createAfterEmailNotification(username, text) {
      // This helper historically omitted notificationType. Do not borrow the
      // general notification helper's required type or suppress repeated events.
      const result = await executeGeneratedOperation<{updateUsers: {users: unknown[]}}>(driver,
        AFTER_EMAIL_NOTIFICATION, {where: {username: {eq: username}}, update: {
          Notifications: [{create: [{node: {text, read: false}}]}],
        }}
      );
      return Boolean(result.updateUsers.users[0]);
    },
  };
}
