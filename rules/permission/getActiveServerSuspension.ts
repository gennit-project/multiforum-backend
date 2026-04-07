import type { Suspension } from "../../ogm_types.js";

type ActiveServerSuspensionInput = {
  context: any;
  username?: string;
  modProfileName?: string;
};

type ActiveServerSuspensionResult = {
  activeSuspension: Suspension | null;
  isSuspended: boolean;
  relatedIssueId: string | null;
  relatedIssueNumber: number | null;
  expiredUserSuspensions: Suspension[];
  expiredModSuspensions: Suspension[];
  suspendedEntity: "user" | "mod" | null;
};

const normalizeValue = (value: any): any => {
  if (value == null) return value;

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
  MATCH (serverConfig:ServerConfig {serverName: $serverName})
  MATCH (serverConfig)-[:SUSPENDED_AS_USER]->(suspension:Suspension)
  OPTIONAL MATCH (suspension)<-[:SUSPENDED_AS_USER]-(suspendedUser:User)
  OPTIONAL MATCH (suspension)-[:HAS_CONTEXT]->(issue:Issue)
  WHERE suspension.username = $username OR suspendedUser.username = $username
  RETURN {
    id: suspension.id,
    username: suspension.username,
    modProfileName: suspension.modProfileName,
    channelUniqueName: suspension.channelUniqueName,
    serverName: suspension.serverName,
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
  MATCH (serverConfig:ServerConfig {serverName: $serverName})
  MATCH (serverConfig)-[:SUSPENDED_AS_MOD]->(suspension:Suspension)
  OPTIONAL MATCH (suspension)<-[:SUSPENDED_AS_MOD]-(suspendedMod:ModerationProfile)
  OPTIONAL MATCH (suspension)-[:HAS_CONTEXT]->(issue:Issue)
  WHERE suspension.modProfileName = $modProfileName OR suspendedMod.displayName = $modProfileName
  RETURN {
    id: suspension.id,
    username: suspension.username,
    modProfileName: suspension.modProfileName,
    channelUniqueName: suspension.channelUniqueName,
    serverName: suspension.serverName,
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

export const isExpiredServerSuspension = (suspension: Suspension, now: Date) => {
  if (suspension.suspendedIndefinitely) return false;
  if (!suspension.suspendedUntil) return false;
  return new Date(suspension.suspendedUntil) <= now;
};

async function fetchTargetedServerSuspensions(params: {
  context: any;
  username?: string;
  modProfileName?: string;
}) {
  const { context, username, modProfileName } = params;
  const session = context.driver.session({ defaultAccessMode: "READ" });

  try {
    const [userResult, modResult] = await Promise.all([
      username
        ? session.run(USER_SUSPENSION_QUERY, {
            serverName: process.env.SERVER_CONFIG_NAME,
            username,
          })
        : Promise.resolve({ records: [] }),
      modProfileName
        ? session.run(MOD_SUSPENSION_QUERY, {
            serverName: process.env.SERVER_CONFIG_NAME,
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
}

export async function getActiveServerSuspension(
  input: ActiveServerSuspensionInput
): Promise<ActiveServerSuspensionResult> {
  const { context, username, modProfileName } = input;

  if (!username && !modProfileName) {
    throw new Error("Must provide a username or modProfileName to check server suspension.");
  }

  const now = new Date();
  const expiredUserSuspensions: Suspension[] = [];
  const expiredModSuspensions: Suspension[] = [];

  const { userSuspensions, modSuspensions } = await fetchTargetedServerSuspensions({
    context,
    username,
    modProfileName,
  });

  const activeUserSuspension = (userSuspensions as Suspension[]).find((suspension) => {
    if (isExpiredServerSuspension(suspension, now)) {
      expiredUserSuspensions.push(suspension);
      return false;
    }

    return true;
  }) ?? null;

  const activeModSuspension = (modSuspensions as Suspension[]).find((suspension) => {
    if (isExpiredServerSuspension(suspension, now)) {
      expiredModSuspensions.push(suspension);
      return false;
    }

    return true;
  }) ?? null;

  const activeSuspension = activeUserSuspension || activeModSuspension;
  const suspendedEntity = activeUserSuspension
    ? "user"
    : activeModSuspension
      ? "mod"
      : null;

  return {
    activeSuspension,
    isSuspended: Boolean(activeSuspension),
    relatedIssueId: activeSuspension?.RelatedIssue?.id || null,
    relatedIssueNumber: activeSuspension?.RelatedIssue?.issueNumber || null,
    expiredUserSuspensions,
    expiredModSuspensions,
    suspendedEntity,
  };
}
