// Resolves the *full* effective role (every capability flag) for the current
// caller, so the no-privilege-escalation guard can compare a requested role
// input against what the caller actually holds. The existing has*Permission
// helpers only answer a single-capability yes/no; this returns the whole role.
//
// The tier-selection logic mirrors hasServerPermission.evaluateServerPermission
// and hasServerModPermission (root > super-admin > admin > moderator > default,
// with suspension taking precedence over tier). Kept here as a separate, pure,
// unit-tested function so the guard never has to re-implement it ad hoc.
import type { GraphQLContext } from "../../types/context.js";
import { isServerRoot } from "./isServerRoot.js";
import { setUserDataOnContext } from "./userDataHelperFunctions.js";
import { getServerConfigForPermissions } from "./getServerConfigForPermissions.js";
import { getActiveServerSuspension } from "./getActiveServerSuspension.js";

// A role is a flat map of capability name -> granted, modeled loosely so this is
// decoupled from the generated OGM role types.
type RoleLike = Record<string, boolean | null | undefined> | null | undefined;

// "all" means the caller holds every capability (the env break-glass root, and
// — for mod capabilities — a non-suspended server admin). `null` means no
// governing role could be resolved (treated as "grants nothing" by the guard,
// i.e. fail closed).
export type EffectiveRole = RoleLike | "all";

// Real capabilities only. (The legacy display-only tag flags have been removed;
// ADMIN/MOD badges are membership-derived, not role flags.)
export const SERVER_ROLE_CAPABILITY_FIELDS = [
  "canCreateChannel",
  "canCreateDiscussion",
  "canCreateEvent",
  "canCreateComment",
  "canUpvoteDiscussion",
  "canUpvoteComment",
  "canUploadFile",
  "canGiveFeedback",
  "canManageServerSettings",
  "canManagePlugins",
  "canManageRoles",
  "canManageMods",
  "canManageAdmins",
  "canManageSuperAdmins",
] as const;

export const MOD_SERVER_ROLE_CAPABILITY_FIELDS = [
  "canLockChannel",
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
  "canPermanentlyRemoveImage",
  "canRemoveDiscussionChannel",
  "canRemoveEventChannel",
] as const;

// Channel-scoped role capabilities (no server-administration power). Used by the
// PR-4c channel-role-authoring guard.
export const CHANNEL_ROLE_CAPABILITY_FIELDS = [
  "canCreateDiscussion",
  "canCreateEvent",
  "canCreateComment",
  "canUpvoteDiscussion",
  "canUpvoteComment",
  "canUploadFile",
  "canUpdateChannel",
] as const;

export const MOD_CHANNEL_ROLE_CAPABILITY_FIELDS = [
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

// --- Pure tier selection (extracted for unit testing) ---

export function resolveEffectiveServerRole(input: {
  isRoot: boolean;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  hasActiveSuspension: boolean;
  defaultServerRole: RoleLike;
  defaultSuspendedRole: RoleLike;
  adminRole: RoleLike;
  superAdminRole: RoleLike;
}): EffectiveRole {
  if (input.isRoot) {
    return "all";
  }
  // Suspension takes precedence over tier (mirrors evaluateServerPermission).
  if (input.hasActiveSuspension) {
    return input.defaultSuspendedRole ?? null;
  }
  return (
    (input.isSuperAdmin ? input.superAdminRole : null) ??
    (input.isAdmin ? input.adminRole : null) ??
    input.defaultServerRole ??
    null
  );
}

export function resolveEffectiveModServerRole(input: {
  isRoot: boolean;
  isAdmin: boolean;
  isModerator: boolean;
  hasActiveSuspension: boolean;
  defaultModRole: RoleLike;
  defaultElevatedModRole: RoleLike;
  defaultSuspendedModRole: RoleLike;
}): EffectiveRole {
  if (input.isRoot) {
    return "all";
  }
  // Suspension takes precedence over tier (mirrors hasServerModPermission).
  if (input.hasActiveSuspension) {
    return input.defaultSuspendedModRole ?? null;
  }
  // A non-suspended server admin holds every mod capability.
  if (input.isAdmin) {
    return "all";
  }
  if (input.isModerator) {
    return input.defaultElevatedModRole ?? input.defaultModRole ?? null;
  }
  return input.defaultModRole ?? null;
}

// --- Context wrappers (fetch data, then select) ---

export async function getActorServerRoleCaps(
  context: GraphQLContext
): Promise<EffectiveRole> {
  if (!context.user?.data) {
    context.user = await setUserDataOnContext({ context });
  }
  if (isServerRoot(context)) {
    return "all";
  }

  const username = context.user?.username;
  const serverConfig = await getServerConfigForPermissions(context);
  if (!serverConfig) {
    return null;
  }

  let hasActiveSuspension = false;
  if (username) {
    const suspension = await getActiveServerSuspension({ context, username });
    hasActiveSuspension = suspension.isSuspended;
  }

  const isSuperAdmin =
    !!username &&
    (serverConfig.SuperAdmins ?? []).some(
      (member: { username?: string | null }) => member?.username === username
    );
  const isAdmin =
    !!username &&
    (serverConfig.Admins ?? []).some(
      (member: { username?: string | null }) => member?.username === username
    );

  return resolveEffectiveServerRole({
    isRoot: false,
    isSuperAdmin,
    isAdmin,
    hasActiveSuspension,
    defaultServerRole: serverConfig.DefaultServerRole as RoleLike,
    defaultSuspendedRole: serverConfig.DefaultSuspendedRole as RoleLike,
    adminRole: serverConfig.DefaultAdminRole as RoleLike,
    superAdminRole: serverConfig.DefaultSuperAdminRole as RoleLike,
  });
}

export async function getActorModServerRoleCaps(
  context: GraphQLContext
): Promise<EffectiveRole> {
  if (!context.user?.data) {
    context.user = await setUserDataOnContext({ context });
  }
  if (isServerRoot(context)) {
    return "all";
  }

  const username = context.user?.username;
  const modProfileName = context.user?.data?.ModerationProfile?.displayName;
  const serverConfig = await getServerConfigForPermissions(context);
  if (!serverConfig) {
    return null;
  }

  let hasActiveSuspension = false;
  if (username || modProfileName) {
    const suspension = await getActiveServerSuspension({
      context,
      username: username ?? undefined,
      modProfileName: modProfileName ?? undefined,
    });
    hasActiveSuspension = suspension.isSuspended;
  }

  const isAdmin =
    !!username &&
    (serverConfig.Admins ?? []).some(
      (member: { username?: string | null }) => member?.username === username
    );
  const isModerator =
    !!modProfileName &&
    (serverConfig.Moderators ?? []).some(
      (member: { displayName?: string | null }) =>
        member?.displayName === modProfileName
    );

  return resolveEffectiveModServerRole({
    isRoot: false,
    isAdmin,
    isModerator,
    hasActiveSuspension,
    defaultModRole: serverConfig.DefaultModRole as RoleLike,
    defaultElevatedModRole: serverConfig.DefaultElevatedModRole as RoleLike,
    defaultSuspendedModRole: serverConfig.DefaultSuspendedModRole as RoleLike,
  });
}
