import neo4j, { type Driver } from "neo4j-driver";
import { resolveNeo4jDatabase } from "../neo4jDatabase.js";

const CHANNEL_ROLE_CAPABILITIES = [
  "canCreateDiscussion",
  "canCreateEvent",
  "canCreateComment",
  "canUpvoteDiscussion",
  "canUpvoteComment",
  "canUploadFile",
  "canUpdateChannel",
] as const;

const MOD_CHANNEL_ROLE_CAPABILITIES = [
  "canHideComment",
  "canHideEvent",
  "canHideDiscussion",
  "canEditComments",
  "canEditDiscussions",
  "canEditEvents",
  "canGiveFeedback",
  "canOpenSupportTickets",
  "canCloseSupportTickets",
  "canReport",
  "canSuspendUser",
  "canArchiveImage",
  "canDeleteWiki",
] as const;

export type ChannelPermission = (typeof CHANNEL_ROLE_CAPABILITIES)[number];
export type ChannelCapabilityMap = Record<
  string,
  boolean | null | undefined
>;

export type ChannelAuthorizationSnapshot = {
  locked?: boolean | null;
  Admins: Array<{ username?: string | null }>;
  Moderators: Array<{ displayName?: string | null }>;
  DefaultChannelRole?: ChannelCapabilityMap | null;
  ElevatedChannelRole?: ChannelCapabilityMap | null;
  SuspendedRole?: ChannelCapabilityMap | null;
  DefaultModRole?: ChannelCapabilityMap | null;
  ElevatedModRole?: ChannelCapabilityMap | null;
  SuspendedModRole?: ChannelCapabilityMap | null;
};

export type ChannelPermissionSuspension = {
  id: string;
  username?: string | null;
  modProfileName?: string | null;
  suspendedUntil?: string | null;
  suspendedIndefinitely?: boolean | null;
  RelatedIssue?: { id?: string | null; issueNumber?: number | null } | null;
  SuspendedUser?: { username?: string | null } | null;
  SuspendedMod?: { displayName?: string | null } | null;
};

export type TargetedChannelSuspensions = {
  userSuspensions: ChannelPermissionSuspension[];
  modSuspensions: ChannelPermissionSuspension[];
};

export interface ChannelPermissionRepository {
  findAuthorizationSnapshot(
    channelUniqueName: string
  ): Promise<ChannelAuthorizationSnapshot | null>;
  findTargetedSuspensions(input: {
    channelUniqueName: string;
    username?: string;
    modProfileName?: string;
  }): Promise<TargetedChannelSuspensions>;
}

const roleProjection = (variable: string, fields: readonly string[]) =>
  `${variable} { ${fields.map((field) => `.${field}`).join(", ")} }`;

export const CHANNEL_AUTHORIZATION_SNAPSHOT_QUERY = `
  MATCH (channel:Channel {uniqueName: $channelUniqueName})
  RETURN {
    locked: channel.locked,
    Admins: [
      (channel)<-[:ADMIN_OF_CHANNEL]-(admin:User) |
      { username: admin.username }
    ],
    Moderators: [
      (channel)<-[:MODERATOR_OF_CHANNEL]-(moderator:ModerationProfile) |
      { displayName: moderator.displayName }
    ],
    DefaultChannelRole: head([
      (channel)-[:HAS_DEFAULT_CHANNEL_ROLE]->(role:ChannelRole) |
      ${roleProjection("role", CHANNEL_ROLE_CAPABILITIES)}
    ]),
    ElevatedChannelRole: head([
      (channel)-[:HAS_DEFAULT_ELEVATED_CHANNEL_ROLE]->(role:ChannelRole) |
      ${roleProjection("role", CHANNEL_ROLE_CAPABILITIES)}
    ]),
    SuspendedRole: head([
      (channel)-[:HAS_DEFAULT_SUSPENDED_ROLE]->(role:ChannelRole) |
      ${roleProjection("role", CHANNEL_ROLE_CAPABILITIES)}
    ]),
    DefaultModRole: head([
      (channel)-[:HAS_DEFAULT_MOD_ROLE]->(role:ModChannelRole) |
      ${roleProjection("role", MOD_CHANNEL_ROLE_CAPABILITIES)}
    ]),
    ElevatedModRole: head([
      (channel)-[:HAS_DEFAULT_ELEVATED_MOD_ROLE]->(role:ModChannelRole) |
      ${roleProjection("role", MOD_CHANNEL_ROLE_CAPABILITIES)}
    ]),
    SuspendedModRole: head([
      (channel)-[:HAS_DEFAULT_SUSPENDED_ROLE]->(role:ModChannelRole) |
      ${roleProjection("role", MOD_CHANNEL_ROLE_CAPABILITIES)}
    ])
  } AS channel
  LIMIT 1
`;

export const USER_CHANNEL_SUSPENSION_QUERY = `
  MATCH (channel:Channel {uniqueName: $channelUniqueName})
  MATCH (channel)-[:SUSPENDED_AS_USER]->(suspension:Suspension)
  OPTIONAL MATCH (suspension)<-[:SUSPENDED_AS_USER]-(suspendedUser:User)
  WITH suspension, suspendedUser
  WHERE suspension.username = $username OR suspendedUser.username = $username
  OPTIONAL MATCH (suspension)-[:HAS_CONTEXT]->(issue:Issue)
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

export const MOD_CHANNEL_SUSPENSION_QUERY = `
  MATCH (channel:Channel {uniqueName: $channelUniqueName})
  MATCH (channel)-[:SUSPENDED_AS_MOD]->(suspension:Suspension)
  OPTIONAL MATCH (suspension)<-[:SUSPENDED_AS_MOD]-(suspendedMod:ModerationProfile)
  WITH suspension, suspendedMod
  WHERE suspension.modProfileName = $modProfileName OR suspendedMod.displayName = $modProfileName
  OPTIONAL MATCH (suspension)-[:HAS_CONTEXT]->(issue:Issue)
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

const normalizeNeo4jValue = (value: unknown): any => {
  if (neo4j.isInt(value)) return value.toNumber();
  if (Array.isArray(value)) return value.map(normalizeNeo4jValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        normalizeNeo4jValue(nestedValue),
      ])
    );
  }
  return value;
};

export function createChannelPermissionRepository(
  driver: Driver,
  database = resolveNeo4jDatabase()
): ChannelPermissionRepository {
  const openAuthorizationSession = () =>
    driver.session({
      database,
      // Keep authorization reads on the leader so request bookmarks preserve
      // read-your-own-writes behavior on causal clusters.
      defaultAccessMode: neo4j.session.WRITE,
    });

  return {
    async findAuthorizationSnapshot(channelUniqueName) {
      const session = openAuthorizationSession();
      try {
        const result = await session.run(CHANNEL_AUTHORIZATION_SNAPSHOT_QUERY, {
          channelUniqueName,
        });
        const value = result.records[0]?.get("channel");
        return value
          ? (normalizeNeo4jValue(value) as ChannelAuthorizationSnapshot)
          : null;
      } finally {
        await session.close();
      }
    },

    async findTargetedSuspensions({
      channelUniqueName,
      username,
      modProfileName,
    }) {
      const session = openAuthorizationSession();
      try {
        // Neo4j sessions do not support concurrent queries. A moderation
        // target may provide both identifiers, so execute these in sequence.
        const userResult = username
          ? await session.run(USER_CHANNEL_SUSPENSION_QUERY, {
              channelUniqueName,
              username,
            })
          : { records: [] };
        const modResult = modProfileName
          ? await session.run(MOD_CHANNEL_SUSPENSION_QUERY, {
              channelUniqueName,
              modProfileName,
            })
          : { records: [] };

        return {
          userSuspensions: userResult.records.map((record) =>
            normalizeNeo4jValue(record.get("suspension"))
          ),
          modSuspensions: modResult.records.map((record) =>
            normalizeNeo4jValue(record.get("suspension"))
          ),
        };
      } finally {
        await session.close();
      }
    },
  };
}
