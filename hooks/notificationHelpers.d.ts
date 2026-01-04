export type CreateInAppNotificationInput = {
  UserModel: any;
  username: string;
  text: string;
};

export function createInAppNotification(
  input: CreateInAppNotificationInput
): Promise<boolean>;
