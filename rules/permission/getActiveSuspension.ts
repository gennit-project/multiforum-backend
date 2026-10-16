// Helper to classify active and expired suspensions for a user/mod in a
// channel. Persistence is delegated to the channel permission repository.
import type {
  ChannelPermissionRepository,
  ChannelPermissionSuspension,
} from "../../services/persistence/channelPermissionRepository.js";

type ActiveSuspensionInput = {
  repository: ChannelPermissionRepository;
  channelUniqueName: string;
  username?: string;
  modProfileName?: string;
};

export type ActiveSuspensionResult = {
  activeSuspension: ChannelPermissionSuspension | null;
  isSuspended: boolean;
  relatedIssueId: string | null;
  relatedIssueNumber: number | null;
  expiredUserSuspensions: ChannelPermissionSuspension[];
  expiredModSuspensions: ChannelPermissionSuspension[];
  suspendedEntity: "user" | "mod" | null;
};

export const isExpiredSuspension = (
  suspension: ChannelPermissionSuspension,
  now: Date
): boolean => {
  if (suspension.suspendedIndefinitely) return false;
  if (!suspension.suspendedUntil) return false;
  return new Date(suspension.suspendedUntil) <= now;
};

export async function getActiveSuspension(
  input: ActiveSuspensionInput
): Promise<ActiveSuspensionResult> {
  const { repository, channelUniqueName, username, modProfileName } = input;

  if (!username && !modProfileName) {
    throw new Error("Must provide a username or modProfileName to check suspension.");
  }

  const { userSuspensions, modSuspensions } =
    await repository.findTargetedSuspensions({
      channelUniqueName,
      username,
      modProfileName,
    });
  const now = new Date();
  const expiredUserSuspensions: ChannelPermissionSuspension[] = [];
  const expiredModSuspensions: ChannelPermissionSuspension[] = [];

  const activeUserSuspension = userSuspensions.find((s) => {
    if (isExpiredSuspension(s, now)) {
      expiredUserSuspensions.push(s);
      return false;
    }
    return true;
  }) || null;

  const activeModSuspension = modSuspensions.find((s) => {
    if (isExpiredSuspension(s, now)) {
      expiredModSuspensions.push(s);
      return false;
    }
    return true;
  }) || null;

  const activeSuspension = activeUserSuspension || activeModSuspension || null;
  const suspendedEntity = activeUserSuspension
    ? "user"
    : activeModSuspension
    ? "mod"
    : null;

  return {
    activeSuspension,
    isSuspended: !!activeSuspension,
    relatedIssueId:
      activeSuspension?.RelatedIssue?.id || null,
    relatedIssueNumber:
      activeSuspension?.RelatedIssue?.issueNumber || null,
    expiredUserSuspensions,
    expiredModSuspensions,
    suspendedEntity,
  };
}
