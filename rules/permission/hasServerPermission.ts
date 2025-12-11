import { setUserDataOnContext } from "./userDataHelperFunctions.js";
import { ERROR_MESSAGES } from "../errorMessages.js";
import { ServerRole } from "../../ogm_types.js";

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

  return new Error(ERROR_MESSAGES.channel.noChannelPermission);
}

export const hasServerPermission: (
  permission: keyof ServerRole,
  context: any
) => Promise<Error | boolean> = async (permission, context) => {
  // 1. Check for server roles on the user object.
  context.user = await setUserDataOnContext({
    context,
    getPermissionInfo: true,
  });
  const usersServerRoles = context.user?.data?.ServerRoles || [];

  const username = context.user?.username;
  const Suspension = context.ogm.model("Suspension");
  const nowIso = new Date().toISOString();

  let hasActiveSuspension = false;
  if (username) {
    const activeSuspensions = await Suspension.find({
      where: {
        username,
        OR: [
          { suspendedIndefinitely: true },
          { suspendedUntil_GT: nowIso },
        ],
      },
      selectionSet: `{ id suspendedIndefinitely suspendedUntil }`,
    });
    hasActiveSuspension = (activeSuspensions?.length || 0) > 0;
  }

  const ServerConfig = context.ogm.model("ServerConfig");
  const serverConfig = await ServerConfig.find({
    where: { serverName: process.env.SERVER_CONFIG_NAME },
    selectionSet: `{ 
      DefaultServerRole { 
        canCreateChannel
        canUploadFile
      } 
      DefaultSuspendedRole {
        canCreateChannel
        canUploadFile
      }
    }`,
  });

  if (!serverConfig || !serverConfig[0]) {
    return new Error(
      "While checking server permissions, could not find the server config, which contains the default server role. Therefore could not check the user's permissions."
    );
  }

  const defaultServerRole = serverConfig[0]?.DefaultServerRole;
  const defaultSuspendedRole = serverConfig[0]?.DefaultSuspendedRole;

  const result = evaluateServerPermission({
    permission,
    userRoles: usersServerRoles,
    defaultServerRole,
    defaultSuspendedRole,
    hasActiveSuspension,
  });

  return result;
};
