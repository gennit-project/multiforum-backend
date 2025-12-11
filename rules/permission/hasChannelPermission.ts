import { setUserDataOnContext } from "./userDataHelperFunctions.js";
import { ERROR_MESSAGES } from "../errorMessages.js";
import { ChannelRole } from "../../ogm_types.js";
import { getActiveSuspension } from "./getActiveSuspension.js";
import { disconnectExpiredSuspensions } from "./disconnectExpiredSuspensions.js";
import { createSuspensionNotification } from "./suspensionNotification.js";

type HasChannelPermissionInput = {
  permission: keyof ChannelRole;
  channelName: string;
  context: any;
};

export const hasChannelPermission: (
  input: HasChannelPermissionInput
) => Promise<Error | boolean> = async (input: HasChannelPermissionInput) => {
  const { permission, channelName, context } = input;

  const Channel = context.ogm.model("Channel");
  const User = context.ogm.model("User");

  // Set user data on context
  context.user = await setUserDataOnContext({
    context,
    getPermissionInfo: true,
    checkSpecificChannel: channelName,
  });

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
  if (channelData.Admins?.some((admin: any) => admin.username === username)) {
    return true;
  }

  // Check for an active suspension
  const suspensionInfo = await getActiveSuspension({
    ogm: context.ogm,
    channelUniqueName: channelName,
    username,
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

  // Determine which role to use
  let roleToUse = null;

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

  if (suspensionInfo.isSuspended) {
    // Use suspended role
    roleToUse = channelData.SuspendedRole;
    // Use server default suspended role as fallback
    if (!roleToUse) {
      roleToUse = serverConfig[0]?.DefaultSuspendedRole;
    }
  } else {    
    // If no specific role, use channel default
    if (!roleToUse && channelData.DefaultChannelRole) {
      roleToUse = channelData.DefaultChannelRole;
    }
    
    // 7. If no channel default, fall back to server default
    if (!roleToUse) {
      roleToUse = serverConfig[0]?.DefaultServerRole;
    }
  }

  // 8. Check if the role exists and has the required permission
  if (!roleToUse) {
    return new Error(ERROR_MESSAGES.channel.noChannelPermission);
  }

  if (roleToUse[permission] === true) {
    return true;
  }

  // If blocked due to suspension, create a notification for transparency.
  if (suspensionInfo.isSuspended && username) {
    try {
      await createSuspensionNotification({
        UserModel: User,
        username,
        channelName,
        permission,
        relatedIssueId: suspensionInfo.relatedIssueId,
        actorType: "user",
      });
    } catch (error) {
      console.error("Failed to create suspension notification", error);
    }
  }

  return new Error(`The user does not have the required permission (${permission}) in channel ${channelName}.`);
};

type CheckChannelPermissionInput = {
  channelConnections: string[];
  context: any;
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
