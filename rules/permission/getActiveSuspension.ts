// Helper to fetch an active suspension for a user/mod in a channel.
// This is a pure read function with no side effects.
import type {
  Suspension,
  ChannelModel,
} from "../../ogm_types.js";

type ActiveSuspensionInput = {
  ogm: any;
  driver?: any;
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

type SuspensionRecord = {
  id: string;
  username?: string | null;
  modProfileName?: string | null;
  suspendedUntil?: string | null;
  suspendedIndefinitely?: boolean | null;
  RelatedIssue?: { id?: string | null; issueNumber?: number | null } | null;
  SuspendedUser?: { username?: string | null } | null;
  SuspendedMod?: { displayName?: string | null } | null;
};

const normalizeValue = (value: any): any => {
  if (value == null) {
    return value;
  }

  if (typeof value.toNumber === "function") {
    return value.toNumber();
  }

  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        normalizeValue(nestedValue),
      ])
    );
  }

  return value;
};

const USER_SUSPENSION_QUERY = `
  MATCH (channel:Channel {uniqueName: $channelUniqueName})
  MATCH (channel)-[:SUSPENDED_AS_USER]->(suspension:Suspension)
  OPTIONAL MATCH (suspension)<-[:SUSPENDED_AS_USER]-(suspendedUser:User)
  OPTIONAL MATCH (suspension)-[:HAS_CONTEXT]->(issue:Issue)
  WHERE suspension.username = $username OR suspendedUser.username = $username
  RETURN {
    id: suspension.id,
    username: suspension.username,
    modProfileName: suspension.modProfileName,
    suspendedUntil: CASE
      WHEN suspension.suspendedUntil IS NULL THEN NULL
      ELSE toString(suspension.suspendedUntil)
    END,
    suspendedIndefinitely: suspension.suspendedIndefinitely,
    RelatedIssue: CASE
      WHEN issue IS NULL THEN NULL
      ELSE { id: issue.id, issueNumber: issue.issueNumber }
    END,
    SuspendedUser: CASE
      WHEN suspendedUser IS NULL THEN NULL
      ELSE { username: suspendedUser.username }
    END
  } AS suspension
`;

const MOD_SUSPENSION_QUERY = `
  MATCH (channel:Channel {uniqueName: $channelUniqueName})
  MATCH (channel)-[:SUSPENDED_AS_MOD]->(suspension:Suspension)
  OPTIONAL MATCH (suspension)<-[:SUSPENDED_AS_MOD]-(suspendedMod:ModerationProfile)
  OPTIONAL MATCH (suspension)-[:HAS_CONTEXT]->(issue:Issue)
  WHERE suspension.modProfileName = $modProfileName OR suspendedMod.displayName = $modProfileName
  RETURN {
    id: suspension.id,
    username: suspension.username,
    modProfileName: suspension.modProfileName,
    suspendedUntil: CASE
      WHEN suspension.suspendedUntil IS NULL THEN NULL
      ELSE toString(suspension.suspendedUntil)
    END,
    suspendedIndefinitely: suspension.suspendedIndefinitely,
    RelatedIssue: CASE
      WHEN issue IS NULL THEN NULL
      ELSE { id: issue.id, issueNumber: issue.issueNumber }
    END,
    SuspendedMod: CASE
      WHEN suspendedMod IS NULL THEN NULL
      ELSE { displayName: suspendedMod.displayName }
    END
  } AS suspension
`;

const fetchTargetedSuspensions = async (params: {
  driver: any;
  channelUniqueName: string;
  username?: string;
  modProfileName?: string;
}): Promise<{
  userSuspensions: SuspensionRecord[];
  modSuspensions: SuspensionRecord[];
}> => {
  const { driver, channelUniqueName, username, modProfileName } = params;
  const session = driver.session({ defaultAccessMode: "READ" });

  try {
    const [userResult, modResult] = await Promise.all([
      username
        ? session.run(USER_SUSPENSION_QUERY, {
            channelUniqueName,
            username,
          })
        : Promise.resolve({ records: [] }),
      modProfileName
        ? session.run(MOD_SUSPENSION_QUERY, {
            channelUniqueName,
            modProfileName,
          })
        : Promise.resolve({ records: [] }),
    ]);

    return {
      userSuspensions: userResult.records.map((record: any) =>
        normalizeValue(record.get("suspension"))
      ),
      modSuspensions: modResult.records.map((record: any) =>
        normalizeValue(record.get("suspension"))
      ),
    };
  } finally {
    await session.close();
  }
};

export async function getActiveSuspension(
  input: ActiveSuspensionInput
): Promise<ActiveSuspensionResult> {
  const { ogm, driver, channelUniqueName, username, modProfileName } = input;

  if (!username && !modProfileName) {
    throw new Error("Must provide a username or modProfileName to check suspension.");
  }

  const now = new Date();

  const expiredUserSuspensions: Suspension[] = [];
  const expiredModSuspensions: Suspension[] = [];
  let userSuspensions: Suspension[] = [];
  let modSuspensions: Suspension[] = [];

  if (driver) {
    const targetedSuspensions = await fetchTargetedSuspensions({
      driver,
      channelUniqueName,
      username,
      modProfileName,
    });
    userSuspensions = targetedSuspensions.userSuspensions as Suspension[];
    modSuspensions = targetedSuspensions.modSuspensions as Suspension[];
  } else {
    const Channel: ChannelModel = ogm.model("Channel");
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

    userSuspensions =
      (username
        ? (channel.SuspendedUsers || []).filter((s: Suspension) => {
            const suspensionUsername =
              s.username || (s as any)?.SuspendedUser?.username;
            return suspensionUsername === username;
          })
        : []) ?? [];

    modSuspensions =
      (modProfileName
        ? (channel.SuspendedMods || []).filter((s: Suspension) => {
            const suspensionDisplayName =
              (s as any).modProfileName || (s as any)?.SuspendedMod?.displayName;
            return suspensionDisplayName === modProfileName;
          })
        : []) ?? [];
  }

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
