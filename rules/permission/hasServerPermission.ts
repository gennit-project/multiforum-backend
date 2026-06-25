import { setUserDataOnContext } from "./userDataHelperFunctions.js";
import { ERROR_MESSAGES } from "../errorMessages.js";
import { ServerRole } from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import { getServerConfigForPermissions } from "./getServerConfigForPermissions.js";
import { getActiveServerSuspension } from "./getActiveServerSuspension.js";
import { disconnectExpiredServerSuspensions } from "./disconnectExpiredServerSuspensions.js";
import { createSuspensionNotification } from "./suspensionNotification.js";
import { isServerRoot } from "./isServerRoot.js";
import { logger } from "../../logger.js";

type EvaluateServerPermissionInput = {
  permission: keyof ServerRole;
  defaultServerRole?: ServerRole | null;
  defaultSuspendedRole?: ServerRole | null;
  hasActiveSuspension: boolean;
  // Tier inputs (see docs/isadmin-phaseout-design.md). All optional so existing
  // callers/tests keep working: with none set, this evaluates the default
  // server role exactly as before.
  isRoot?: boolean;
  isSuperAdmin?: boolean;
  isAdmin?: boolean;
  superAdminRole?: ServerRole | null;
  adminRole?: ServerRole | null;
};

export function evaluateServerPermission(input: EvaluateServerPermissionInput) {
  const {
    permission,
    defaultServerRole,
    defaultSuspendedRole,
    hasActiveSuspension,
    isRoot = false,
    isSuperAdmin = false,
    isAdmin = false,
    superAdminRole,
    adminRole,
  } = input;

  // The env break-glass root holds every capability unconditionally.
  if (isRoot) {
    return true;
  }

  // Suspension takes precedence over tier (a suspended admin is restricted).
  if (hasActiveSuspension) {
    const suspendedRole = defaultSuspendedRole;
    if (!suspendedRole) {
      return new Error(ERROR_MESSAGES.server.noServerPermission);
    }
    return suspendedRole[permission] === true
      ? true
      : new Error(ERROR_MESSAGES.server.noServerPermission);
  }

  // Pick the governing role by tier, falling back to the default server role
  // when a tier role is not configured yet (keeps behavior unchanged until the
  // admin/super-admin roles are seeded — see the PR-2 migration).
  const effectiveRole =
    (isSuperAdmin ? superAdminRole : null) ??
    (isAdmin ? adminRole : null) ??
    defaultServerRole;

  if (!effectiveRole) {
    return new Error(
      "Could not find permission on user's role or on the default server role."
    );
  }

  // Generic capability check (replaces the previous hard-coded
  // canCreateChannel / canUploadFile branches) so any ServerRole flag works.
  return effectiveRole[permission] === true
    ? true
    : new Error(ERROR_MESSAGES.server.noServerPermission);
}

export const hasServerPermission: (
  permission: keyof ServerRole,
  context: GraphQLContext
) => Promise<Error | boolean> = async (permission, context) => {
  const User = context.ogm.model("User");
  // 1. Check for server roles on the user object.
  if (!context.user?.data) {
    context.user = await setUserDataOnContext({
      context,
    });
  }
  const username = context.user?.username;
  let hasActiveSuspension = false;
  let suspensionInfo: Awaited<ReturnType<typeof getActiveServerSuspension>> | null =
    null;

  if (username) {
    suspensionInfo = await getActiveServerSuspension({
      context,
      username,
    });

    hasActiveSuspension = suspensionInfo.isSuspended;

    if (
      suspensionInfo.expiredUserSuspensions.length > 0 ||
      suspensionInfo.expiredModSuspensions.length > 0
    ) {
      disconnectExpiredServerSuspensions({
        context,
        expiredUserSuspensions: suspensionInfo.expiredUserSuspensions,
        expiredModSuspensions: suspensionInfo.expiredModSuspensions,
      }).catch((error) => {
        logger.error("Failed to disconnect expired server suspensions", error);
      });
    }
  }

  const serverConfig = await getServerConfigForPermissions(context);

  if (!serverConfig) {
    return new Error(
      "While checking server permissions, could not find the server config, which contains the default server role. Therefore could not check the user's permissions."
    );
  }

  const defaultServerRole = serverConfig.DefaultServerRole;
  const defaultSuspendedRole = serverConfig.DefaultSuspendedRole;

  // Tier detection: env root (break-glass) > super-admin > admin > default.
  // Tier roles fall back to the default server role inside
  // evaluateServerPermission until they are seeded (PR-2 migration), so this is
  // behavior-preserving for existing servers.
  const isRoot = isServerRoot(context);
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

  const result = evaluateServerPermission({
    permission,
    defaultServerRole,
    defaultSuspendedRole,
    hasActiveSuspension,
    isRoot,
    isSuperAdmin,
    isAdmin,
    superAdminRole: serverConfig.DefaultSuperAdminRole,
    adminRole: serverConfig.DefaultAdminRole,
  });

  if (result instanceof Error && hasActiveSuspension && username) {
    try {
      await createSuspensionNotification({
        UserModel: User,
        username,
        scopeName: process.env.SERVER_CONFIG_NAME || "server",
        scopeType: "server",
        permission,
        relatedIssueId: suspensionInfo?.relatedIssueId || null,
        relatedIssueNumber: suspensionInfo?.relatedIssueNumber || null,
        suspendedUntil: suspensionInfo?.activeSuspension?.suspendedUntil || null,
        suspendedIndefinitely:
          suspensionInfo?.activeSuspension?.suspendedIndefinitely || null,
        actorType: "user",
      });
    } catch (error) {
      logger.error("Failed to create server suspension notification", error);
    }
  }

  return result;
};
