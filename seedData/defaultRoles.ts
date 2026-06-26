// Canonical default seed data for a newly-provisioned Multiforum instance.
//
// This is the single source of truth for the default roles. It is consumed by:
//   - seedData/provisionServerDefaults.ts (bootstrap a fresh instance + the
//     isAdmin-phase-out migration)
//   - integration tests (so they exercise the real defaults instead of
//     re-seeding inline)
//
// Roles are keyed by their unique `name`; provisioning is idempotent (MERGE by
// name), so editing a value here and re-running provisioning updates it.
// See docs/isadmin-phaseout-design.md.

// ---------------------------------------------------------------------------
// Role names (stable identifiers used for wiring + MERGE).
// ---------------------------------------------------------------------------
export const ROLE_NAMES = {
  serverStandard: "Standard User Role",
  serverSuspended: "Suspended Server Role",
  administrator: "Administrator", // restricted admin: cannot make admins
  superAdministrator: "Super Administrator", // can make admins
  modBasic: "Basic Server Mod Role",
  modElevated: "Elevated Server Mod Role",
  modSuspended: "Suspended Server Mod Role",
  channelDefault: "Default Channel Role",
  channelElevated: "Elevated Channel Role", // channel owner tier
  channelSuspended: "Suspended Channel Role",
} as const;

// ---------------------------------------------------------------------------
// ServerRole defaults (user/admin "creative" capabilities).
// ---------------------------------------------------------------------------
const NO_SERVER_ADMIN_CAPS = {
  canManageServerSettings: false,
  canManagePlugins: false,
  canManageRoles: false,
  canManageMods: false,
  canManageAdmins: false,
  canManageSuperAdmins: false,
};

const ALL_CONTENT_CAPS = {
  canCreateChannel: true,
  canCreateDiscussion: true,
  canCreateEvent: true,
  canCreateComment: true,
  canUpvoteDiscussion: true,
  canUpvoteComment: true,
  canUploadFile: true,
  canGiveFeedback: true,
};

// Note: roles are permissions-only. The ADMIN/MOD display tag is NOT a role
// flag — it derives from the user's membership relationship to ServerConfig /
// Channel (server-admin membership for the ADMIN badge; the
// `authorIsChannelModerator` @cypher field for the channel MOD badge). The
// legacy `showAdminTag` / `showModTag` schema fields have been removed.
// See docs/isadmin-phaseout-design.md.
export const DEFAULT_SERVER_ROLES = [
  {
    // Standard signed-in user: can create/participate, no administration.
    name: ROLE_NAMES.serverStandard,
    description: "Default role for a standard signed-in user.",
    ...ALL_CONTENT_CAPS,
    ...NO_SERVER_ADMIN_CAPS,
  },
  {
    // Server-suspended user: read-only.
    name: ROLE_NAMES.serverSuspended,
    description: "Applied to a server-suspended user; no capabilities.",
    canCreateChannel: false,
    canCreateDiscussion: false,
    canCreateEvent: false,
    canCreateComment: false,
    canUpvoteDiscussion: false,
    canUpvoteComment: false,
    canUploadFile: false,
    canGiveFeedback: false,
    ...NO_SERVER_ADMIN_CAPS,
  },
  {
    // Restricted admin: permissive, but CANNOT create other admins.
    name: ROLE_NAMES.administrator,
    description:
      "Restricted administrator: full administration except creating/removing admins.",
    ...ALL_CONTENT_CAPS,
    canManageServerSettings: true,
    canManagePlugins: true,
    canManageRoles: true,
    canManageMods: true,
    canManageAdmins: false,
    canManageSuperAdmins: false,
  },
  {
    // Super administrator: everything, including making/removing admins.
    name: ROLE_NAMES.superAdministrator,
    description:
      "Super administrator: full administration including managing admins and super-admins.",
    ...ALL_CONTENT_CAPS,
    canManageServerSettings: true,
    canManagePlugins: true,
    canManageRoles: true,
    canManageMods: true,
    canManageAdmins: true,
    canManageSuperAdmins: true,
  },
] as const;

// ---------------------------------------------------------------------------
// ModServerRole defaults (moderation / destructive capabilities).
// ---------------------------------------------------------------------------
const NO_MOD_CAPS = {
  canLockChannel: false,
  canHideComment: false,
  canHideEvent: false,
  canHideDiscussion: false,
  canEditComments: false,
  canEditDiscussions: false,
  canEditEvents: false,
  canGiveFeedback: false,
  canOpenSupportTickets: false,
  canCloseSupportTickets: false,
  canReport: false,
  canSuspendUser: false,
  canArchiveImage: false,
  canDeleteWiki: false,
  canPermanentlyRemoveImage: false,
  canRemoveDiscussionChannel: false,
  canRemoveEventChannel: false,
};

export const DEFAULT_MOD_SERVER_ROLES = [
  {
    // Baseline mod: can report and triage support, no destructive actions.
    name: ROLE_NAMES.modBasic,
    description: "Baseline server moderator capabilities.",
    ...NO_MOD_CAPS,
    canReport: true,
    canGiveFeedback: true,
    canOpenSupportTickets: true,
  },
  {
    // Elevated mod: every moderation capability, including structural removals.
    name: ROLE_NAMES.modElevated,
    description: "Elevated server moderator: all moderation capabilities.",
    canLockChannel: true,
    canHideComment: true,
    canHideEvent: true,
    canHideDiscussion: true,
    canEditComments: true,
    canEditDiscussions: true,
    canEditEvents: true,
    canGiveFeedback: true,
    canOpenSupportTickets: true,
    canCloseSupportTickets: true,
    canReport: true,
    canSuspendUser: true,
    canArchiveImage: true,
    canDeleteWiki: true,
    canPermanentlyRemoveImage: true,
    canRemoveDiscussionChannel: true,
    canRemoveEventChannel: true,
  },
  {
    name: ROLE_NAMES.modSuspended,
    description: "Applied to a suspended moderator; no capabilities.",
    ...NO_MOD_CAPS,
  },
] as const;

// ---------------------------------------------------------------------------
// ChannelRole defaults. Channels are provisioned with these at channel-creation
// time; defined here so the source of truth is shared. The elevated role is the
// channel-owner tier (see hasChannelPermission).
// ---------------------------------------------------------------------------
// As with server roles, the MOD display tag is not set here — it should derive
// from Channel membership (Moderators), not a role flag.
export const DEFAULT_CHANNEL_ROLES = [
  {
    name: ROLE_NAMES.channelDefault,
    description: "Default role for a standard member of a channel.",
    canCreateDiscussion: true,
    canCreateEvent: true,
    canCreateComment: true,
    canUpvoteDiscussion: true,
    canUpvoteComment: true,
    canUploadFile: true,
    canUpdateChannel: false,
  },
  {
    name: ROLE_NAMES.channelElevated,
    description: "Channel owner tier: every channel capability.",
    canCreateDiscussion: true,
    canCreateEvent: true,
    canCreateComment: true,
    canUpvoteDiscussion: true,
    canUpvoteComment: true,
    canUploadFile: true,
    canUpdateChannel: true,
  },
  {
    name: ROLE_NAMES.channelSuspended,
    description: "Applied to a channel-suspended user; no capabilities.",
    canCreateDiscussion: false,
    canCreateEvent: false,
    canCreateComment: false,
    canUpvoteDiscussion: false,
    canUpvoteComment: false,
    canUploadFile: false,
    canUpdateChannel: false,
  },
] as const;

// ---------------------------------------------------------------------------
// ServerConfig tier -> default-role wiring. Maps each ServerConfig default-role
// relationship to the role name that should fill it.
// ---------------------------------------------------------------------------
export const SERVER_CONFIG_ROLE_WIRING = {
  DefaultServerRole: ROLE_NAMES.serverStandard,
  DefaultSuspendedRole: ROLE_NAMES.serverSuspended,
  DefaultAdminRole: ROLE_NAMES.administrator,
  DefaultSuperAdminRole: ROLE_NAMES.superAdministrator,
  DefaultModRole: ROLE_NAMES.modBasic,
  DefaultElevatedModRole: ROLE_NAMES.modElevated,
  DefaultSuspendedModRole: ROLE_NAMES.modSuspended,
} as const;
