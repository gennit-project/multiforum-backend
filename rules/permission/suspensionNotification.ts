type CreateSuspensionNotificationInput = {
  UserModel: any;
  username: string;
  channelName: string;
  permission: string;
  relatedIssueId?: string | null;
  actorType: "user" | "mod";
};

/**
 * Creates a one-off in-app notification explaining why a suspended user/mod was blocked.
 * Deduplicates by exact text to avoid spamming on repeated attempts.
 */
export async function createSuspensionNotification(
  input: CreateSuspensionNotificationInput
) {
  const { UserModel, username, channelName, permission, relatedIssueId, actorType } = input;

  if (!username) return;

  const issueRef = relatedIssueId
    ? `Issue ${relatedIssueId}`
    : "the related moderation issue";
  const subject =
    actorType === "mod"
      ? `Your moderator account is suspended in ${channelName}`
      : `You are suspended in ${channelName}`;
  const notificationText = `${subject} and cannot ${permission}. See ${issueRef} for details.`;

  // Escape quotes for the selectionSet filter
  const escapedText = notificationText.replace(/"/g, '\\"');

  const existing = await UserModel.find({
    where: { username },
    selectionSet: `{ Notifications(where: { text: "${escapedText}", read: false }) { id } }`,
  });

  const alreadyNotified = existing?.[0]?.Notifications?.length > 0;
  if (alreadyNotified) return;

  await UserModel.update({
    where: { username },
    update: {
      Notifications: [
        {
          create: [
            {
              node: {
                text: notificationText,
                read: false,
              },
            },
          ],
        },
      ],
    },
  });
}
