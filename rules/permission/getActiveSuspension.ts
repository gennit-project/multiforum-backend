// Helper to fetch an active suspension for a user/mod in a channel.
// This is a pure read function with no side effects.
import type {
  Suspension,
  ChannelModel,
} from "../../ogm_types.js";

type ActiveSuspensionInput = {
  ogm: any;
  channelUniqueName: string;
  username?: string;
  modProfileName?: string;
};

type ActiveSuspensionResult = {
  activeSuspension: Suspension | null;
  isSuspended: boolean;
  relatedIssueId: string | null;
  relatedIssueNumber: number | null;
  expiredUserSuspensions: Suspension[];
  expiredModSuspensions: Suspension[];
  suspendedEntity: "user" | "mod" | null;
};

export const isExpiredSuspension = (suspension: Suspension, now: Date) => {
  if (suspension.suspendedIndefinitely) return false;
  if (!suspension.suspendedUntil) return false;
  return new Date(suspension.suspendedUntil) <= now;
};

export async function getActiveSuspension(
  input: ActiveSuspensionInput
): Promise<ActiveSuspensionResult> {
  const { ogm, channelUniqueName, username, modProfileName } = input;

  if (!username && !modProfileName) {
    throw new Error("Must provide a username or modProfileName to check suspension.");
  }

  const Channel: ChannelModel = ogm.model("Channel");
  const now = new Date();

  const selectionSet = `{
    SuspendedUsers {
      id
      username
      suspendedUntil
      suspendedIndefinitely
      RelatedIssue { id issueNumber }
      SuspendedUser { username }
    }
    SuspendedMods {
      id
      modProfileName
      suspendedUntil
      suspendedIndefinitely
      RelatedIssue { id issueNumber }
      SuspendedMod { displayName }
    }
  }`;

  const channelData = await Channel.find({
    where: { uniqueName: channelUniqueName },
    selectionSet,
  });

  const channel = channelData?.[0];
  if (!channel) {
    return {
      activeSuspension: null,
      isSuspended: false,
      relatedIssueId: null,
      relatedIssueNumber: null,
      expiredUserSuspensions: [],
      expiredModSuspensions: [],
      suspendedEntity: null,
    };
  }

  const expiredUserSuspensions: Suspension[] = [];
  const expiredModSuspensions: Suspension[] = [];

  const userSuspensions: Suspension[] =
    (username
      ? (channel.SuspendedUsers || []).filter((s: Suspension) => {
          const suspensionUsername =
            s.username ||
            (s as any)?.SuspendedUser?.username;
          return suspensionUsername === username;
        })
      : []) ?? [];

  const modSuspensions: Suspension[] =
    (modProfileName
      ? (channel.SuspendedMods || []).filter((s: Suspension) => {
          const suspensionDisplayName =
            (s as any).modProfileName ||
            (s as any)?.SuspendedMod?.displayName;
          return suspensionDisplayName === modProfileName;
        })
      : []) ?? [];

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
      (activeSuspension as any)?.RelatedIssue?.id || null,
    relatedIssueNumber:
      (activeSuspension as any)?.RelatedIssue?.issueNumber || null,
    expiredUserSuspensions,
    expiredModSuspensions,
    suspendedEntity,
  };
}
