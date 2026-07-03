import { setUserDataOnContext } from "./userDataHelperFunctions.js";
import { ERROR_MESSAGES } from "../errorMessages.js";
import type { GraphQLContext } from "../../types/context.js";
import { getActiveSuspension } from "./getActiveSuspension.js";
import { getServerConfigForPermissions } from "./getServerConfigForPermissions.js";
import { disconnectExpiredSuspensions } from "./disconnectExpiredSuspensions.js";
import { createSuspensionNotification } from "./suspensionNotification.js";
import { passesAsServerAdminOrRoot } from "./serverAdminOverride.js";
import { logger } from "../../logger.js";

// Define the moderator permissions as an enum for type safety
export enum ModChannelPermission {
  canHideComment = "canHideComment",
  canHideEvent = "canHideEvent",
  canHideDiscussion = "canHideDiscussion",
  canEditComments = "canEditComments",
  canEditDiscussions = "canEditDiscussions",
  canEditEvents = "canEditEvents",
  canGiveFeedback = "canGiveFeedback",
  canOpenSupportTickets = "canOpenSupportTickets",
  canCloseSupportTickets = "canCloseSupportTickets",
  canReport = "canReport",
  canSuspendUser = "canSuspendUser",
  canArchiveImage = "canArchiveImage",
  canDeleteWiki = "canDeleteWiki"
}

// --- Pure permission decision (extracted for unit testing) ---

// A mod role is a flat map of permission name -> granted. Modeled loosely so the
// decision logic is decoupled from the generated OGM role types.
type ModRole = Record<string, boolean | null | undefined> | null | undefined;

interface ChannelModRoles {
  DefaultModRole?: ModRole;
  ElevatedModRole?: ModRole;
  SuspendedModRole?: ModRole;
  Moderators?: Array<{ displayName?: string | null }> | null;
}

interface ServerModDefaults {
  DefaultModRole?: ModRole;
  DefaultElevatedModRole?: ModRole;
  DefaultSuspendedModRole?: ModRole;
}

/**
 * Selects the governing mod role for a user in a channel and checks a permission.
 *
 * Role precedence mirrors hasChannelModPermission: a suspended mod uses the
 * channel's SuspendedModRole, an elevated mod (listed in Moderators) uses the
 * ElevatedModRole, everyone else uses the DefaultModRole — each falling back to
 * the corresponding server-config default role when the channel defines none.
 *
 * Returns the resolved role (null when neither channel nor server defines one)
 * and whether it grants `permission`. The caller maps a null role to a "no mod
 * role" error and a false `allowed` to a "no permission" error, preserving the
 * original control flow.
 */
export function evaluateChannelModPermission(args: {
  permission: ModChannelPermission;
  channelData: ChannelModRoles;
  serverDefaults: ServerModDefaults | undefined;
  isSuspended: boolean;
  modProfileName: string | null | undefined;
}): { role: ModRole; allowed: boolean } {
  const { permission, channelData, serverDefaults, isSuspended, modProfileName } = args;

  let role: ModRole;
  if (isSuspended) {
    role = channelData.SuspendedModRole ?? serverDefaults?.DefaultSuspendedModRole ?? null;
  } else if (channelData.Moderators?.some((mod) => mod.displayName === modProfileName)) {
    role = channelData.ElevatedModRole ?? serverDefaults?.DefaultElevatedModRole ?? null;
  } else {
    role = channelData.DefaultModRole ?? serverDefaults?.DefaultModRole ?? null;
  }

  const allowed = !!role && role[permission] === true;
  return { role, allowed };
}

type HasChannelModPermissionInput = {
  permission: ModChannelPermission;
  channelName: string;
  context: GraphQLContext;
};

export const hasChannelModPermission: (
  input: HasChannelModPermissionInput
) => Promise<Error | boolean> = async (input: HasChannelModPermissionInput) => {
  const { permission, channelName, context } = input;

  const Channel = context.ogm.model("Channel");
  const User = context.ogm.model("User");

  // 1. Check for mod roles on the user object
  context.user = await setUserDataOnContext({
    context,
  });

  // Server admins and the env break-glass root hold every channel mod
  // permission across the whole server (replaces the per-call-site isAdmin
  // override). See docs/isadmin-phaseout-design.md.
  if (await passesAsServerAdminOrRoot(context)) {
    return true;
  }

  // 2. Check if user has a moderation profile
  const hasModProfile = context.user?.data?.ModerationProfile !== null;
  if (!hasModProfile) {
    return new Error(ERROR_MESSAGES.channel.notMod);
  }

  // 3. Get the channel's mod roles and moderator lists
  const channel = await Channel.find({
    where: {
      uniqueName: channelName,
    },
    selectionSet: `{
      DefaultModRole {
        canHideComment
        canHideEvent
        canHideDiscussion
        canEditComments
        canEditDiscussions
        canEditEvents
        canGiveFeedback
        canOpenSupportTickets
        canCloseSupportTickets
        canReport
        canSuspendUser
        canArchiveImage
        canDeleteWiki
      }
      ElevatedModRole {
        canHideComment
        canHideEvent
        canHideDiscussion
        canEditComments
        canEditDiscussions
        canEditEvents
        canGiveFeedback
        canOpenSupportTickets
        canCloseSupportTickets
        canReport
        canSuspendUser
        canArchiveImage
        canDeleteWiki
      }
      SuspendedModRole {
        canHideComment
        canHideEvent
        canHideDiscussion
        canEditComments
        canEditDiscussions
        canEditEvents
        canGiveFeedback
        canOpenSupportTickets
        canCloseSupportTickets
        canReport
        canSuspendUser
        canArchiveImage
        canDeleteWiki
      }
      SuspendedMods {
        modProfileName
      }
      Moderators {
        displayName
      }
    }`,
  });

  if (!channel || !channel[0]) {
    return new Error(ERROR_MESSAGES.channel.notFound);
  }

  const channelData = channel[0];
  const modProfileName = context.user?.data?.ModerationProfile?.displayName ?? undefined;

  // Request-cached (see hasChannelPermission for rationale); the cached
  // selection set is a superset of the mod-role fields read here.
  const serverConfig = await getServerConfigForPermissions(context);

  const suspensionInfo = await getActiveSuspension({
    ogm: context.ogm,
    driver: context.driver,
    channelUniqueName: channelName,
    modProfileName,
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

  // 4-5. Select the governing mod role (suspended > elevated > default, with
  // server-config fallback) and check the permission. The pure decision is
  // extracted to evaluateChannelModPermission so the role matrix can be unit
  // tested without a database.
  const { role: roleToUse, allowed } = evaluateChannelModPermission({
    permission,
    channelData: channelData as unknown as ChannelModRoles,
    serverDefaults: serverConfig as unknown as ServerModDefaults | undefined,
    isSuspended: suspensionInfo.isSuspended,
    modProfileName,
  });

  if (!roleToUse) {
    return new Error(ERROR_MESSAGES.channel.noModRole);
  }

  if (allowed) {
    return true;
  }

  // If blocked due to suspension, create a notification for transparency.
  if (suspensionInfo.isSuspended && modProfileName && context.user?.username) {
    try {
      await createSuspensionNotification({
        UserModel: User,
        username: context.user.username,
        scopeName: channelName,
        scopeType: "channel",
        permission,
        relatedIssueId: suspensionInfo.relatedIssueId,
        relatedIssueNumber: suspensionInfo.relatedIssueNumber,
        suspendedUntil: suspensionInfo.activeSuspension?.suspendedUntil || null,
        suspendedIndefinitely:
          suspensionInfo.activeSuspension?.suspendedIndefinitely || null,
        actorType: "mod",
      });
    } catch (error) {
      logger.error("Failed to create suspension notification for mod", error);
    }
  }
  return new Error(ERROR_MESSAGES.channel.noModPermission);
};

// Helper function to check mod permissions across multiple channels
export async function checkChannelModPermissions(
  input: {
    channelConnections: string[];
    context: GraphQLContext;
    permissionCheck: ModChannelPermission;
  }
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
    const permissionResult = await hasChannelModPermission({
      permission: permissionCheck,
      channelName: channelConnection,
      context: context,
    });

    if (permissionResult instanceof Error) {
      return permissionResult;
    }
    
    if (permissionResult === false) {
      return new Error(ERROR_MESSAGES.channel.noModPermission);
    }
  }

  return true;
}
