import type { UserModel } from '../ogm_types.js';
import { logger } from "../logger.js";

type CreateInAppNotificationInput = {
  UserModel: UserModel;
  username: string;
  text: string;
  notificationType?: string; // "feedback", "mention", "reply", "moderation", "scratchpad", etc.
};

export const createInAppNotification = async ({
  UserModel,
  username,
  text,
  notificationType,
}: CreateInAppNotificationInput): Promise<boolean> => {
  try {
    const userUpdateResult = await UserModel.update({
      where: { username },
      update: {
        Notifications: [
          {
            create: [
              {
                node: {
                  text,
                  read: false,
                  ...(notificationType && { notificationType }),
                },
              },
            ],
          },
        ],
      },
    });

    return Boolean(userUpdateResult?.users?.length);
  } catch (error) {
    logger.error('Error creating in-app notification:', error);
    return false;
  }
};
