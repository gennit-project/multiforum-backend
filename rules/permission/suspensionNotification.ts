import type { SuspensionEffectsRepository } from "../../services/persistence/suspensionEffectsRepository.js";

type CreateSuspensionNotificationInput = {
  repository: SuspensionEffectsRepository;
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
    repository,
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

  await repository.createBlockNotification({
    username,
    text: notificationText,
  });
}
