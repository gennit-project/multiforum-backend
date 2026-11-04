import type { ChannelUserSuspensionSource, ChannelModSuspensionSource } from "../../customResolvers/contracts/channelSuspensionSource.js";
import type {ChannelAuthorizationRecord,NativeChannelAuthorizationSnapshot,RawChannelCapabilities} from "../../customResolvers/contracts/channelAuthorizationSource.js";
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
export type ChannelCapabilityMap = RawChannelCapabilities;

export type ChannelAuthorizationSnapshot = {
  locked?: unknown;
  Admins: Array<{ username?: unknown }>;
  Moderators: Array<{ displayName?: unknown }>;
  DefaultChannelRole?: ChannelCapabilityMap | null;
  ElevatedChannelRole?: ChannelCapabilityMap | null;
  SuspendedRole?: ChannelCapabilityMap | null;
  DefaultModRole?: ChannelCapabilityMap | null;
  ElevatedModRole?: ChannelCapabilityMap | null;
  SuspendedModRole?: ChannelCapabilityMap | null;
};

// Compatible injected-reader shape; native query containers below are exact.
export type ChannelPermissionSuspension = {
  id: unknown;
  username?: unknown;
  modProfileName?: unknown;
  suspendedUntil?: string | null;
  suspendedIndefinitely?: unknown;
  RelatedIssue?: { id?: unknown; issueNumber?: unknown } | null;
  SuspendedUser?: { username?: unknown } | null;
  SuspendedMod?: { displayName?: unknown } | null;
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

const normalizeNeo4jValue = (value: unknown): unknown => {
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

// Authorization source leaves are
// not asserted to be schema-completed booleans or strings. Preserve the native
// query's exact containers and existing recursive integer normalization.
const normalizeCapabilities=(role:RawChannelCapabilities|null):RawChannelCapabilities|null=>role===null?null:Object.fromEntries(Object.entries(role).map(([key,value])=>[key,normalizeNeo4jValue(value)]));
const normalizeAuthorizationSnapshot=(value:NativeChannelAuthorizationSnapshot):NativeChannelAuthorizationSnapshot=>({
 locked:normalizeNeo4jValue(value.locked),
 Admins:value.Admins.map(admin=>({username:normalizeNeo4jValue(admin.username)})),
 Moderators:value.Moderators.map(moderator=>({displayName:normalizeNeo4jValue(moderator.displayName)})),
 DefaultChannelRole:normalizeCapabilities(value.DefaultChannelRole),
 ElevatedChannelRole:normalizeCapabilities(value.ElevatedChannelRole),
 SuspendedRole:normalizeCapabilities(value.SuspendedRole),
 DefaultModRole:normalizeCapabilities(value.DefaultModRole),
 ElevatedModRole:normalizeCapabilities(value.ElevatedModRole),
 SuspendedModRole:normalizeCapabilities(value.SuspendedModRole),
});

const normalizeSuspensionCore = (value: ChannelUserSuspensionSource | ChannelModSuspensionSource) => ({
  id: normalizeNeo4jValue(value.id),
  username: normalizeNeo4jValue(value.username),
  modProfileName: normalizeNeo4jValue(value.modProfileName),
  suspendedUntil: value.suspendedUntil,
  suspendedIndefinitely: normalizeNeo4jValue(value.suspendedIndefinitely),
  RelatedIssue: value.RelatedIssue == null ? value.RelatedIssue : {
    id: normalizeNeo4jValue(value.RelatedIssue.id),
    issueNumber: normalizeNeo4jValue(value.RelatedIssue.issueNumber),
  },
});

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
        const result = await session.run<ChannelAuthorizationRecord>(CHANNEL_AUTHORIZATION_SNAPSHOT_QUERY, {
          channelUniqueName,
        });
        const value = result.records[0]?.get("channel");
        return value
          ? normalizeAuthorizationSnapshot(value)
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
          ? await session.run<{ suspension: ChannelUserSuspensionSource }>(USER_CHANNEL_SUSPENSION_QUERY, {
              channelUniqueName,
              username,
            })
          : { records: [] };
        const modResult = modProfileName
          ? await session.run<{ suspension: ChannelModSuspensionSource }>(MOD_CHANNEL_SUSPENSION_QUERY, {
              channelUniqueName,
              modProfileName,
            })
          : { records: [] };

        return {
          userSuspensions: userResult.records.map((record): ChannelUserSuspensionSource => {
            const value = record.get("suspension");
            return { ...normalizeSuspensionCore(value), SuspendedUser: value.SuspendedUser == null ? value.SuspendedUser : {
              username: normalizeNeo4jValue(value.SuspendedUser.username),
            } };
          }),
          modSuspensions: modResult.records.map((record): ChannelModSuspensionSource => {
            const value = record.get("suspension");
            return { ...normalizeSuspensionCore(value), SuspendedMod: value.SuspendedMod == null ? value.SuspendedMod : {
              displayName: normalizeNeo4jValue(value.SuspendedMod.displayName),
            } };
          }),
        };
      } finally {
        await session.close();
      }
    },
  };
}

export const resolveChannelPermissionRepository = (context: {
  channelPermissionRepository?: ChannelPermissionRepository;
  driver: Driver;
}): ChannelPermissionRepository =>
  context.channelPermissionRepository ??
  createChannelPermissionRepository(context.driver);
