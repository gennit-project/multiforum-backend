type CreateSuspensionNotificationInput = {
  UserModel: any;
  username: string;
  scopeName: string;
  scopeType: "channel" | "server";
  permission: string;
  relatedIssueId?: string | null;
  relatedIssueNumber?: number | null;
  suspendedUntil?: string | null;
  suspendedIndefinitely?: boolean | null;
  actorType: "user" | "mod";
};

/**
 * Creates a one-off in-app notification explaining why a suspended user/mod was blocked.
 * Deduplicates by exact text to avoid spamming on repeated attempts.
 */
export async function createSuspensionNotification(
  input: CreateSuspensionNotificationInput
) {
  const {
    UserModel,
    username,
    scopeName,
    scopeType,
    permission,
    relatedIssueId,
    relatedIssueNumber,
    suspendedUntil,
    suspendedIndefinitely,
    actorType,
  } = input;

  if (!username) return;

  const issueRef = relatedIssueNumber
    ? scopeType === "server"
      ? `[Issue #${relatedIssueNumber}](/admin/issues/${relatedIssueNumber})`
      : `[Issue #${relatedIssueNumber}](/forums/${scopeName}/issues/${relatedIssueNumber})`
    : relatedIssueId
    ? `Issue ${relatedIssueId}`
    : "the related moderation issue";
  const scopeLabel =
    scopeType === "server" ? "at the server level" : `in ${scopeName}`;
  const subject =
    actorType === "mod"
      ? `Your moderator account is suspended ${scopeLabel}`
      : `You are suspended ${scopeLabel}`;
  const expiresText = suspendedIndefinitely
    ? "Suspension is indefinite."
    : suspendedUntil
    ? `Suspension expires on ${new Date(suspendedUntil).toISOString().slice(0, 10)}.`
    : "";
  const notificationText = `${subject} and cannot ${permission}. See ${issueRef} for details.${expiresText ? ` ${expiresText}` : ""}`;

  // Escape quotes for the selectionSet filter
  const escapedText = notificationText.replace(/"/g, '\\"');

  const existing = await UserModel.find({
    where: { username },
    selectionSet: `{ 
      notifyOnSuspensionBlocks
      Notifications(where: { text: "${escapedText}", read: false }) { id } 
    }`,
  });

  const user = existing?.[0];
  if (user?.notifyOnSuspensionBlocks === false) return;

  const alreadyNotified = user?.Notifications?.length > 0;
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
