import { setUserDataOnContext } from "./userDataHelperFunctions.js";
import { ERROR_MESSAGES } from "../errorMessages.js";
import { getActiveSuspension } from "./getActiveSuspension.js";
import { disconnectExpiredSuspensions } from "./disconnectExpiredSuspensions.js";
import { createSuspensionNotification } from "./suspensionNotification.js";

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
  canSuspendUser = "canSuspendUser"
}

type HasChannelModPermissionInput = {
  permission: ModChannelPermission;
  channelName: string;
  context: any;
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
    getPermissionInfo: true,
    checkSpecificChannel: channelName,
  });

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
  const modProfileName = context.user?.data?.ModerationProfile?.displayName;

  // 4. Determine which role to use based on moderator status
  let roleToUse = null;

  const ServerConfig = context.ogm.model("ServerConfig");
  const serverConfig = await ServerConfig.find({
    where: { serverName: process.env.SERVER_CONFIG_NAME },
    selectionSet: `{ 
      DefaultModRole { 
        canOpenSupportTickets
        canLockChannel
        canCloseSupportTickets
        canGiveFeedback
        canHideComment
        canHideDiscussion
        canHideEvent
        canEditComments
        canEditDiscussions
        canEditEvents
        canGiveFeedback
        canReport
        canSuspendUser
      }
      DefaultSuspendedModRole {
        canOpenSupportTickets
        canLockChannel
        canCloseSupportTickets
        canGiveFeedback
        canHideComment
        canHideDiscussion
        canHideEvent
        canEditComments
        canEditDiscussions
        canEditEvents
        canGiveFeedback
        canReport
        canSuspendUser
      }
      DefaultElevatedModRole {
        canOpenSupportTickets
        canLockChannel
        canCloseSupportTickets
        canGiveFeedback
        canHideComment
        canHideDiscussion
        canHideEvent
        canEditComments
        canEditDiscussions
        canEditEvents
        canGiveFeedback
        canReport
        canSuspendUser
      }
    }`,
  });

  const suspensionInfo = await getActiveSuspension({
    ogm: context.ogm,
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
      console.error("Failed to disconnect expired suspensions", error);
    });
  }

  if (suspensionInfo.isSuspended) {
    roleToUse = channelData.SuspendedModRole;
    // if the channel doesn't have a suspended mod role,
    // use the one from the server config.
    if (!roleToUse) {
      roleToUse = serverConfig[0]?.DefaultSuspendedModRole;
    }
  }
  // Then check if the user is an elevated moderator
  // May create custom cypher query to directly
  // look up if such a mod is listed in the Moderators
  // field on the Channel.
  else if (channelData.Moderators?.some(
    (mod: any) => mod.displayName === modProfileName
  )) {
    roleToUse = channelData.ElevatedModRole;
    // if the channel doesn't have an elevated mod role,
    // use the one from the server config.
    if (!roleToUse) {
      roleToUse = serverConfig[0]?.DefaultElevatedModRole;
    }
  }
  // Finally, use the default mod role
  else {
    roleToUse = channelData.DefaultModRole;
    // if the channel doesn't have a default mod role,
    // use the one from the server config.
    if (!roleToUse) {
      roleToUse = serverConfig[0]?.DefaultModRole;
    }
  }

  // 5. Check if the role exists and has the required permission
  if (!roleToUse) {
    return new Error(ERROR_MESSAGES.channel.noModRole);
  }

  if (roleToUse[permission] === true) {
    return true;
  }

  console.log(`Permission check failed: ${permission} is ${roleToUse[permission]} for role:`, roleToUse);
  // If blocked due to suspension, create a notification for transparency.
  if (suspensionInfo.isSuspended && modProfileName && context.user?.username) {
    try {
      await createSuspensionNotification({
        UserModel: User,
        username: context.user.username,
        channelName,
        permission,
        relatedIssueId: suspensionInfo.relatedIssueId,
        relatedIssueNumber: suspensionInfo.relatedIssueNumber,
        suspendedUntil: suspensionInfo.activeSuspension?.suspendedUntil || null,
        suspendedIndefinitely:
          suspensionInfo.activeSuspension?.suspendedIndefinitely || null,
        actorType: "mod",
      });
    } catch (error) {
      console.error("Failed to create suspension notification for mod", error);
    }
  }
  return false;
};

// Helper function to check mod permissions across multiple channels
export async function checkChannelModPermissions(
  input: {
    channelConnections: string[];
    context: any;
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
      return new Error(`The user does not have the required permission (${permissionCheck}) in channel ${channelConnection}.`);
    }
  }

  return true;
}
