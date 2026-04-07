import { setUserDataOnContext } from "./userDataHelperFunctions.js";
import { ERROR_MESSAGES } from "../errorMessages.js";
import { ServerRole } from "../../ogm_types.js";
import { getServerConfigForPermissions } from "./getServerConfigForPermissions.js";
import { getActiveServerSuspension } from "./getActiveServerSuspension.js";
import { disconnectExpiredServerSuspensions } from "./disconnectExpiredServerSuspensions.js";
import { createSuspensionNotification } from "./suspensionNotification.js";

type EvaluateServerPermissionInput = {
  permission: keyof ServerRole;
  userRoles: ServerRole[];
  defaultServerRole?: ServerRole | null;
  defaultSuspendedRole?: ServerRole | null;
  hasActiveSuspension: boolean;
};

export function evaluateServerPermission(input: EvaluateServerPermissionInput) {
  const { permission, userRoles, defaultServerRole, defaultSuspendedRole, hasActiveSuspension } =
    input;

  // If suspended at the server level, use the default suspended role
  if (hasActiveSuspension) {
    const suspendedRole = defaultSuspendedRole;
    if (!suspendedRole) {
      return new Error(ERROR_MESSAGES.server.noServerPermission);
    }
    return suspendedRole[permission] === true
      ? true
      : new Error(ERROR_MESSAGES.server.noServerPermission);
  }

  // Use explicit server roles on the user if present
  if (userRoles.length > 0) {
    for (const serverRole of userRoles) {
      if (!serverRole[permission]) {
        return new Error(ERROR_MESSAGES.server.noServerPermission);
      }
    }
    return true;
  }

  // Fall back to default server role
  if (!defaultServerRole) {
    return new Error(
      "Could not find permission on user's role or on the default server role."
    );
  }

  if (permission === "canCreateChannel") {
    return defaultServerRole.canCreateChannel === true
      ? true
      : new Error(ERROR_MESSAGES.server.noServerPermission);
  }
  if (permission === "canUploadFile") {
    return defaultServerRole.canUploadFile === true
      ? true
      : new Error(ERROR_MESSAGES.server.noServerPermission);
  }

  return new Error(ERROR_MESSAGES.server.noServerPermission);
}

export const hasServerPermission: (
  permission: keyof ServerRole,
  context: any
) => Promise<Error | boolean> = async (permission, context) => {
  const User = context.ogm.model("User");
  // 1. Check for server roles on the user object.
  if (!context.user?.data) {
    context.user = await setUserDataOnContext({
      context,
      getPermissionInfo: true,
    });
  }
  const usersServerRoles = context.user?.data?.ServerRoles || [];

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
        console.error("Failed to disconnect expired server suspensions", error);
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

  const result = evaluateServerPermission({
    permission,
    userRoles: usersServerRoles,
    defaultServerRole,
    defaultSuspendedRole,
    hasActiveSuspension,
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
      console.error("Failed to create server suspension notification", error);
    }
  }

  return result;
};
