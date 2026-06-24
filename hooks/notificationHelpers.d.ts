import type { UserModel } from '../ogm_types.js';

export type CreateInAppNotificationInput = {
  UserModel: UserModel;
  username: string;
  text: string;
};

export function createInAppNotification(
  input: CreateInAppNotificationInput
): Promise<boolean>;
