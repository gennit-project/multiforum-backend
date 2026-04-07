import { setUserDataOnContext } from "./userDataHelperFunctions.js";
import { ERROR_MESSAGES } from "../errorMessages.js";
import { ModServerRole } from "../../ogm_types.js";
import { getServerConfigForPermissions } from "./getServerConfigForPermissions.js";
import { getServerScopedMembership } from "./getServerScopedMembership.js";
import { getActiveServerSuspension } from "./getActiveServerSuspension.js";
import { disconnectExpiredServerSuspensions } from "./disconnectExpiredServerSuspensions.js";
import { createSuspensionNotification } from "./suspensionNotification.js";

export const hasServerModPermission: (
  permission: keyof ModServerRole,
  context: any
) => Promise<Error | boolean> = async (permission, context) => {
  const User = context.ogm.model("User");
  if (!context.user?.data) {
    context.user = await setUserDataOnContext({
      context,
      getPermissionInfo: true,
    });
  }

  const modProfileName = context.user?.data?.ModerationProfile?.displayName;
  if (!modProfileName) {
    return new Error(ERROR_MESSAGES.channel.notMod);
  }

  const serverConfig = await getServerConfigForPermissions(context);
  if (!serverConfig) {
    throw new Error(
      "Could not find the server config, which contains the default server mod role. Therefore could not check the user's permissions."
    );
  }

  const suspensionInfo = await getActiveServerSuspension({
    context,
    modProfileName,
  });

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

  const membership = await getServerScopedMembership(context);

  if (membership.isServerAdmin) {
    return true;
  }

  let roleToCheck: ModServerRole | null = null;

  if (suspensionInfo.isSuspended) {
    roleToCheck = serverConfig.DefaultSuspendedModRole ?? null;
  } else if (membership.isServerModerator) {
    roleToCheck =
      serverConfig.DefaultElevatedModRole ??
      serverConfig.DefaultModRole ??
      null;
  } else {
    roleToCheck = serverConfig.DefaultModRole ?? null;
  }

  if (!roleToCheck) {
    return new Error(ERROR_MESSAGES.server.noServerPermission);
  }

  if (roleToCheck[permission] === true) {
    return true;
  }

  if (suspensionInfo.isSuspended && context.user?.username) {
    try {
      await createSuspensionNotification({
        UserModel: User,
        username: context.user.username,
        scopeName: process.env.SERVER_CONFIG_NAME || "server",
        scopeType: "server",
        permission,
        relatedIssueId: suspensionInfo.relatedIssueId,
        relatedIssueNumber: suspensionInfo.relatedIssueNumber,
        suspendedUntil: suspensionInfo.activeSuspension?.suspendedUntil || null,
        suspendedIndefinitely:
          suspensionInfo.activeSuspension?.suspendedIndefinitely || null,
        actorType: "mod",
      });
    } catch (error) {
      console.error("Failed to create server mod suspension notification", error);
    }
  }

  return new Error(ERROR_MESSAGES.server.noServerPermission);
};
