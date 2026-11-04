import neo4j, { type Driver } from "neo4j-driver";
import type { RawServerCapabilities, NativeServerAuthorizationSnapshot, ServerAuthorizationRecord } from "../../customResolvers/contracts/serverAuthorizationSource.js";
import { resolveNeo4jDatabase } from "../neo4jDatabase.js";

const SERVER_ROLE_CAPABILITIES = [
  "canCreateChannel",
  "canCreateDiscussion",
  "canCreateEvent",
  "canCreateComment",
  "canUpvoteComment",
  "canUpvoteDiscussion",
  "canUploadFile",
  "canGiveFeedback",
  "canManageServerSettings",
  "canManagePlugins",
  "canManageRoles",
  "canManageMods",
  "canManageAdmins",
  "canManageSuperAdmins",
] as const;

const MOD_SERVER_ROLE_CAPABILITIES = [
  "canOpenSupportTickets",
  "canLockChannel",
  "canCloseSupportTickets",
  "canGiveFeedback",
  "canHideComment",
  "canHideDiscussion",
  "canHideEvent",
  "canEditComments",
  "canEditDiscussions",
  "canEditEvents",
  "canReport",
  "canSuspendUser",
  "canArchiveImage",
  "canDeleteWiki",
  "canPermanentlyRemoveImage",
] as const;

type CapabilityMap = RawServerCapabilities;

export type PermissionSuspension = {
  id?: string | null;
  username?: string | null;
  modProfileName?: string | null;
  serverName?: string | null;
  suspendedUntil?: string | null;
  suspendedIndefinitely?: boolean | null;
  RelatedIssue?: { id?: string | null; issueNumber?: number | null } | null;
};

export type PermissionServerConfig = {
  enableDownloads?: unknown;
  DefaultServerRole?: CapabilityMap | null;
  DefaultSuspendedRole?: CapabilityMap | null;
  DefaultAdminRole?: CapabilityMap | null;
  DefaultSuperAdminRole?: CapabilityMap | null;
  DefaultModRole?: CapabilityMap | null;
  DefaultElevatedModRole?: CapabilityMap | null;
  DefaultSuspendedModRole?: CapabilityMap | null;
  SuperAdmins: Array<{ username?: unknown }>;
  Admins: Array<{ username?: unknown }>;
  Moderators: Array<{ displayName?: unknown }>;
  SuspendedUsers: PermissionSuspension[];
  SuspendedMods: PermissionSuspension[];
};

export interface PermissionServerConfigRepository {
  findByName(serverName: string | undefined): Promise<PermissionServerConfig | null>;
}

const roleProjection = (variable: string, fields: readonly string[]) =>
  `${variable} { ${fields.map((field) => `.${field}`).join(", ")} }`;

const serverRoleProjection = (variable: string) =>
  roleProjection(variable, SERVER_ROLE_CAPABILITIES);
const modServerRoleProjection = (variable: string) =>
  roleProjection(variable, MOD_SERVER_ROLE_CAPABILITIES);

export const PERMISSION_SERVER_CONFIG_QUERY = `
  MATCH (serverConfig:ServerConfig {serverName: $serverName})
  RETURN {
    enableDownloads: serverConfig.enableDownloads,
    DefaultServerRole: head([
      (serverConfig)-[:HAS_DEFAULT_SERVER_ROLE]->(role:ServerRole) |
      ${serverRoleProjection("role")}
    ]),
    DefaultSuspendedRole: head([
      (serverConfig)-[:HAS_DEFAULT_SUSPENDED_ROLE]->(role:ServerRole) |
      ${serverRoleProjection("role")}
    ]),
    DefaultAdminRole: head([
      (serverConfig)-[:HAS_DEFAULT_ADMIN_ROLE]->(role:ServerRole) |
      ${serverRoleProjection("role")}
    ]),
    DefaultSuperAdminRole: head([
      (serverConfig)-[:HAS_DEFAULT_SUPER_ADMIN_ROLE]->(role:ServerRole) |
      ${serverRoleProjection("role")}
    ]),
    DefaultModRole: head([
      (serverConfig)-[:HAS_DEFAULT_MOD_ROLE]->(role:ModServerRole) |
      ${modServerRoleProjection("role")}
    ]),
    DefaultElevatedModRole: head([
      (serverConfig)-[:HAS_DEFAULT_ELEVATED_MOD_ROLE]->(role:ModServerRole) |
      ${modServerRoleProjection("role")}
    ]),
    DefaultSuspendedModRole: head([
      (serverConfig)-[:HAS_DEFAULT_SUSPENDED_ROLE]->(role:ModServerRole) |
      ${modServerRoleProjection("role")}
    ]),
    SuperAdmins: [
      (serverConfig)<-[:SUPER_ADMIN_OF_SERVER]-(user:User) |
      { username: user.username }
    ],
    Admins: [
      (serverConfig)<-[:ADMIN_OF_SERVER]-(user:User) |
      { username: user.username }
    ],
    Moderators: [
      (serverConfig)<-[:MODERATOR_OF_SERVER]-(profile:ModerationProfile) |
      { displayName: profile.displayName }
    ],
    SuspendedUsers: [
      (serverConfig)-[:SUSPENDED_AS_USER]->(suspension:Suspension) |
      suspension {
        .id,
        .username,
        .modProfileName,
        .serverName,
        suspendedUntil: CASE
          WHEN suspension.suspendedUntil IS NULL THEN NULL
          ELSE toString(suspension.suspendedUntil)
        END,
        .suspendedIndefinitely,
        RelatedIssue: head([
          (suspension)-[:HAS_CONTEXT]->(issue:Issue) |
          issue { .id, .issueNumber }
        ])
      }
    ],
    SuspendedMods: [
      (serverConfig)-[:SUSPENDED_AS_MOD]->(suspension:Suspension) |
      suspension {
        .id,
        .username,
        .modProfileName,
        .serverName,
        suspendedUntil: CASE
          WHEN suspension.suspendedUntil IS NULL THEN NULL
          ELSE toString(suspension.suspendedUntil)
        END,
        .suspendedIndefinitely,
        RelatedIssue: head([
          (suspension)-[:HAS_CONTEXT]->(issue:Issue) |
          issue { .id, .issueNumber }
        ])
      }
    ]
  } AS serverConfig
  LIMIT 1
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

const normalizeCapabilities = (
  role: RawServerCapabilities | null
): RawServerCapabilities | null => role === null ? null : Object.fromEntries(
  Object.entries(role).map(([key, value]) => [key, normalizeNeo4jValue(value)])
);

const normalizeAuthorizationSnapshot = (
  value: NativeServerAuthorizationSnapshot
): PermissionServerConfig => ({
  enableDownloads: normalizeNeo4jValue(value.enableDownloads),
  DefaultServerRole: normalizeCapabilities(value.DefaultServerRole),
  DefaultSuspendedRole: normalizeCapabilities(value.DefaultSuspendedRole),
  DefaultAdminRole: normalizeCapabilities(value.DefaultAdminRole),
  DefaultSuperAdminRole: normalizeCapabilities(value.DefaultSuperAdminRole),
  DefaultModRole: normalizeCapabilities(value.DefaultModRole),
  DefaultElevatedModRole: normalizeCapabilities(value.DefaultElevatedModRole),
  DefaultSuspendedModRole: normalizeCapabilities(value.DefaultSuspendedModRole),
  SuperAdmins: value.SuperAdmins.map(member => ({ username: normalizeNeo4jValue(member.username) })),
  Admins: value.Admins.map(member => ({ username: normalizeNeo4jValue(member.username) })),
  Moderators: value.Moderators.map(member => ({ displayName: normalizeNeo4jValue(member.displayName) })),
  // Keep the pre-existing suspension adapter separate from the untrusted
  // capability/identity contract. Its nested leaves still need migration.
  SuspendedUsers: value.SuspendedUsers.map(normalizeNeo4jValue),
  SuspendedMods: value.SuspendedMods.map(normalizeNeo4jValue),
});

export function createPermissionServerConfigRepository(
  driver: Driver,
  database = resolveNeo4jDatabase()
): PermissionServerConfigRepository {
  return {
    async findByName(serverName) {
      // Authorization reads intentionally use a WRITE-mode session so they
      // remain leader-routed. The installed driver wrapper adds the current
      // request's bookmark manager to this session for causal consistency.
      const session = driver.session({
        database,
        defaultAccessMode: neo4j.session.WRITE,
      });
      try {
        const result = await session.run<ServerAuthorizationRecord>(PERMISSION_SERVER_CONFIG_QUERY, {
          serverName: serverName ?? null,
        });
        const value = result.records[0]?.get("serverConfig");
        return value
          ? normalizeAuthorizationSnapshot(value)
          : null;
      } finally {
        await session.close();
      }
    },
  };
}
