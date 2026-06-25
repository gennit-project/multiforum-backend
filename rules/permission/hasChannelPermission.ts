import { setUserDataOnContext } from "./userDataHelperFunctions.js";
import { ERROR_MESSAGES } from "../errorMessages.js";
import { ChannelRole } from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import { getActiveSuspension } from "./getActiveSuspension.js";
import { disconnectExpiredSuspensions } from "./disconnectExpiredSuspensions.js";
import { createSuspensionNotification } from "./suspensionNotification.js";
import { logger } from "../../logger.js";

type HasChannelPermissionInput = {
  permission: keyof ChannelRole;
  channelName: string;
  context: GraphQLContext;
};

// --- Pure permission decision (extracted for unit testing) ---

// A channel role is a flat map of permission name -> granted, modeled loosely so
// the decision logic is decoupled from the generated OGM role types.
type ChannelRoleLike = Record<string, boolean | null | undefined> | null | undefined;

interface ChannelRoles {
  DefaultChannelRole?: ChannelRoleLike;
  SuspendedRole?: ChannelRoleLike;
}

interface ServerRoleDefaults {
  DefaultServerRole?: ChannelRoleLike;
  DefaultSuspendedRole?: ChannelRoleLike;
}

// Channel owners (admins) get every permission. Mirrors the Admins.some() check.
export function isChannelAdmin(
  admins: Array<{ username?: string | null }> | null | undefined,
  username: string | null | undefined
): boolean {
  return !!admins?.some((admin) => admin.username === username);
}

/**
 * Selects the governing channel role for a (non-owner) user and checks a
 * permission. A suspended user uses the channel's SuspendedRole, everyone else
 * the DefaultChannelRole — each falling back to the corresponding server-config
 * default when the channel defines none.
 *
 * Returns the resolved role (null when neither channel nor server defines one)
 * and whether it grants `permission`, preserving the wrapper's control flow
 * (a null role and allowed=false both map to a "no permission" error).
 */
export function evaluateChannelRolePermission(args: {
  permission: string;
  channelData: ChannelRoles;
  serverDefaults: ServerRoleDefaults | undefined;
  isSuspended: boolean;
}): { role: ChannelRoleLike; allowed: boolean } {
  const { permission, channelData, serverDefaults, isSuspended } = args;

  let role: ChannelRoleLike;
  if (isSuspended) {
    role = channelData.SuspendedRole ?? serverDefaults?.DefaultSuspendedRole ?? null;
  } else {
    role = channelData.DefaultChannelRole ?? serverDefaults?.DefaultServerRole ?? null;
  }

  const allowed = !!role && role[permission] === true;
  return { role, allowed };
}

export const hasChannelPermission: (
  input: HasChannelPermissionInput
) => Promise<Error | boolean> = async (input: HasChannelPermissionInput) => {
  const { permission, channelName, context } = input;

  const Channel = context.ogm.model("Channel");
  const User = context.ogm.model("User");

  if (!context.user?.username) {
    context.user = await setUserDataOnContext({
      context,
    });
  }

  if (!context.user) {
    return new Error(ERROR_MESSAGES.channel.noChannelPermission);
  }

  const username = context.user?.username;

  // Check if user is a channel owner (admin) - channel owners have all permissions
  const channel = await Channel.find({
    where: {
      uniqueName: channelName,
    },
    selectionSet: `{ 
      Admins {
        username
      }
      DefaultChannelRole { 
        name
        canCreateEvent
        canCreateDiscussion
        canCreateComment
        canUpvoteComment
        canUpvoteDiscussion
        canUploadFile
        canUpdateChannel
      }
      SuspendedRole {
        name
        canCreateEvent
        canCreateDiscussion
        canCreateComment
        canUpvoteComment
        canUpvoteDiscussion
        canUploadFile
        canUpdateChannel
      }
    }`,
  });

  if (!channel || !channel[0]) {
    return new Error(ERROR_MESSAGES.channel.notFound);
  }

  const channelData = channel[0];

  // Check if user is admin/owner - if so, grant all permissions
  if (isChannelAdmin(channelData.Admins, username)) {
    return true;
  }

  // Check for an active suspension
  const suspensionInfo = await getActiveSuspension({
    ogm: context.ogm,
    driver: context.driver,
    channelUniqueName: channelName,
    username: username ?? undefined,
  });

  // Clean up any expired suspensions (fire-and-forget, don't block on result)
  if (suspensionInfo.expiredUserSuspensions.length > 0 || suspensionInfo.expiredModSuspensions.length > 0) {
    disconnectExpiredSuspensions({
      ogm: context.ogm,
      channelUniqueName: channelName,
      expiredUserSuspensions: suspensionInfo.expiredUserSuspensions,
      expiredModSuspensions: suspensionInfo.expiredModSuspensions,
    }).catch((error) => {
      logger.error("Failed to disconnect expired suspensions", error);
    });
  }

  // Fetch server config for default roles
  const ServerConfig = context.ogm.model("ServerConfig");
  const serverConfig = await ServerConfig.find({
    where: { serverName: process.env.SERVER_CONFIG_NAME },
    selectionSet: `{ 
      DefaultServerRole { 
        canCreateChannel
        canCreateEvent
        canCreateDiscussion
        canCreateComment
        canUpvoteComment
        canUpvoteDiscussion
        canUploadFile
      }
      DefaultSuspendedRole {
        canCreateChannel
        canCreateEvent
        canCreateDiscussion
        canCreateComment
        canUpvoteComment
        canUpvoteDiscussion
        canUploadFile
      }
    }`,
  });

  // Select the governing role (suspended vs default, with server-config
  // fallback) and check the permission. The pure decision is extracted to
  // evaluateChannelRolePermission so the role matrix can be unit tested.
  const { role: roleToUse, allowed } = evaluateChannelRolePermission({
    permission,
    channelData: channelData as unknown as ChannelRoles,
    serverDefaults: serverConfig[0] as unknown as ServerRoleDefaults | undefined,
    isSuspended: suspensionInfo.isSuspended,
  });

  if (!roleToUse) {
    return new Error(ERROR_MESSAGES.channel.noChannelPermission);
  }

  if (allowed) {
    return true;
  }

  // If blocked due to suspension, create a notification for transparency.
  if (suspensionInfo.isSuspended && username) {
    try {
      await createSuspensionNotification({
        UserModel: User,
        username,
        scopeName: channelName,
        scopeType: "channel",
        permission,
        relatedIssueId: suspensionInfo.relatedIssueId,
        relatedIssueNumber: suspensionInfo.relatedIssueNumber,
        suspendedUntil: suspensionInfo.activeSuspension?.suspendedUntil || null,
        suspendedIndefinitely:
          suspensionInfo.activeSuspension?.suspendedIndefinitely || null,
        actorType: "user",
      });
    } catch (error) {
      logger.error("Failed to create suspension notification", error);
    }
  }

  return new Error(ERROR_MESSAGES.channel.noChannelPermission);
};

type CheckChannelPermissionInput = {
  channelConnections: string[];
  context: GraphQLContext;
  permissionCheck: keyof ChannelRole;
};

// Helper function to check channel permissions across multiple channels
export async function checkChannelPermissions(
  input: CheckChannelPermissionInput
) {
  const { channelConnections, context, permissionCheck } = input;
  
  // Check for JWT errors first (expired tokens, etc.)
  if (context.jwtError) {
    return context.jwtError;
  }
  
  // Check if we have valid channel connections
  if (!channelConnections || channelConnections.length === 0 || !channelConnections[0]) {
    return new Error("No channel specified for this operation.");
  }

  for (const channelConnection of channelConnections) {
    const permissionResult = await hasChannelPermission({
      permission: permissionCheck,
      channelName: channelConnection,
      context: context,
    });

    if (permissionResult instanceof Error) {
      return permissionResult;
    }
  }

  return true;
}
