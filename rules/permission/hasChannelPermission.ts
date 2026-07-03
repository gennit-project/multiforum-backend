import { setUserDataOnContext } from "./userDataHelperFunctions.js";
import { ERROR_MESSAGES } from "../errorMessages.js";
import { ChannelRole } from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import { getActiveSuspension } from "./getActiveSuspension.js";
import { getServerConfigForPermissions } from "./getServerConfigForPermissions.js";
import { disconnectExpiredSuspensions } from "./disconnectExpiredSuspensions.js";
import { createSuspensionNotification } from "./suspensionNotification.js";
import { passesAsServerAdminOrRoot } from "./serverAdminOverride.js";
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
  ElevatedChannelRole?: ChannelRoleLike;
  DefaultChannelRole?: ChannelRoleLike;
  SuspendedRole?: ChannelRoleLike;
}

interface ServerRoleDefaults {
  DefaultServerRole?: ChannelRoleLike;
  DefaultSuspendedRole?: ChannelRoleLike;
}

// True when the user is listed among the channel's owners (admins).
export function isChannelAdmin(
  admins: Array<{ username?: string | null }> | null | undefined,
  username: string | null | undefined
): boolean {
  return !!admins?.some((admin) => admin.username === username);
}

// Owner (channel admin) permission. Owners resolve the channel's configurable
// elevated role; until one is configured they retain every permission (current
// behavior). See docs/isadmin-phaseout-design.md.
export function evaluateChannelOwnerPermission(
  elevatedChannelRole: ChannelRoleLike,
  permission: string
): boolean {
  if (!elevatedChannelRole) {
    return true;
  }
  return elevatedChannelRole[permission] === true;
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

  // Server admins and the env break-glass root hold every channel permission
  // across the whole server (this replaces the per-call-site isAdmin override).
  // See docs/isadmin-phaseout-design.md.
  if (await passesAsServerAdminOrRoot(context)) {
    return true;
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
      ElevatedChannelRole {
        name
        canCreateEvent
        canCreateDiscussion
        canCreateComment
        canUpvoteComment
        canUpvoteDiscussion
        canUploadFile
        canUpdateChannel
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

  // Channel owners (admins) resolve the channel's elevated role (with a
  // behavior-preserving fallback to all-permissions when none is configured).
  if (isChannelAdmin(channelData.Admins, username)) {
    const elevatedRole = (channelData as unknown as ChannelRoles).ElevatedChannelRole;
    return evaluateChannelOwnerPermission(elevatedRole, permission)
      ? true
      : new Error(ERROR_MESSAGES.channel.noChannelPermission);
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

  // Fetch server config for default roles. Request-cached: this is process-
  // global config, identical across the whole request, so re-fetching it per
  // channel per rule is pure waste. getServerConfigForPermissions memoizes it
  // on the context, and its selection set is a superset of the fields read here.
  const serverConfig = await getServerConfigForPermissions(context);

  // Select the governing role (suspended vs default, with server-config
  // fallback) and check the permission. The pure decision is extracted to
  // evaluateChannelRolePermission so the role matrix can be unit tested.
  const { role: roleToUse, allowed } = evaluateChannelRolePermission({
    permission,
    channelData: channelData as unknown as ChannelRoles,
    serverDefaults: serverConfig as unknown as ServerRoleDefaults | undefined,
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

/**
 * A locked channel is frozen: no new discussions, events, comments, or wiki
 * edits may be created by anyone — including channel owners and server admins.
 * A server moderator with `canLockChannel` must unlock the forum first (this
 * mirrors the per-entity lock convention in contentCreationRules, where a
 * locked discussion/event/comment is read-only regardless of the actor).
 *
 * Returns an Error when the channel is locked, otherwise null.
 */
async function getChannelLockError(
  channelName: string,
  context: GraphQLContext
): Promise<Error | null> {
  const Channel = context.ogm.model("Channel");
  const channel = await Channel.find({
    where: { uniqueName: channelName },
    selectionSet: `{ locked }`,
  });

  if (channel?.[0]?.locked) {
    return new Error(ERROR_MESSAGES.channel.locked);
  }
  return null;
}

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
    // A locked forum blocks content creation for everyone; surface a clear
    // reason before falling through to the per-role permission check.
    const lockError = await getChannelLockError(channelConnection, context);
    if (lockError) {
      return lockError;
    }

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
