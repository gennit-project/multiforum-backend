type CreateInAppNotificationInput = {
  UserModel: any;
  username: string;
  text: string;
};

export const createInAppNotification = async ({
  UserModel,
  username,
  text,
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
                },
              },
            ],
          },
        ],
      },
    });

    return Boolean(userUpdateResult?.users?.length);
  } catch (error) {
    console.error('Error creating in-app notification:', error);
    return false;
  }
};
