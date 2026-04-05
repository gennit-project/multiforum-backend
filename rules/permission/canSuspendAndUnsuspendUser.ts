import { checkChannelModPermissions } from "./hasChannelModPermission.js";
import { ModChannelPermission } from "./hasChannelModPermission.js";
import { rule } from "graphql-shield";
import { ERROR_MESSAGES } from "../errorMessages.js";
import { getServerScopedMembership } from "./getServerScopedMembership.js";

// Helper function to check if a user is a channel owner
async function isUserChannelOwner(username: string, channelName: string, context: any): Promise<boolean> {
  const Channel = context.ogm.model("Channel");
  
  const channel = await Channel.find({
    where: { uniqueName: channelName },
    selectionSet: `{ 
      Admins { 
        username
      } 
    }`,
  });

  if (!channel || !channel[0]) {
    return false;
  }

  const channelOwners = channel[0].Admins.map((admin: any) => admin.username);
  return channelOwners.includes(username);
}

// Helper function to check if current user is a site admin
async function isUserSiteAdmin(context: any): Promise<boolean> {
  const membership = await getServerScopedMembership(context);
  return membership.isServerAdmin;
}

export const canSuspendAndUnsuspendUser = rule({ cache: "contextual" })(
  async (parent: any, args: any, context: any, info: any) => {
    let channelUniqueName = args.channelUniqueName;
    const issueId = args.issueId;
    const targetUsername = args.username; // The username of the user to be suspended
    
    console.log('can suspend and unsuspend user');
    console.log("channelUniqueName", channelUniqueName);
    console.log("issueId", issueId);
    console.log("targetUsername", targetUsername);
    
    // If channelUniqueName is not provided, look it up from the issue
    if (!channelUniqueName && issueId) {
      const Issue = context.ogm.model("Issue");
      const issue = await Issue.find({
        where: { id: issueId },
        selectionSet: `{ 
          channelUniqueName
        }`,
      });

      if (!issue || !issue[0]) {
        return new Error("Could not find the issue or its associated channel.");
      }

      channelUniqueName = issue[0].channelUniqueName;
    }

    if (!channelUniqueName) {
      return new Error("No channel specified for this operation.");
    }
    
    // Check if the target user is a channel owner
    if (targetUsername) {
      const isChannelOwner = await isUserChannelOwner(targetUsername, channelUniqueName, context);
      
      if (isChannelOwner) {
        // If target is a channel owner, only site admins can suspend them
        const isSiteAdmin = await isUserSiteAdmin(context);
        
        if (!isSiteAdmin) {
          return new Error(ERROR_MESSAGES.channel.cantSuspendOwner);
        }
        
        // If user is a site admin, they can suspend the channel owner
        return true;
      }
    }
    
    // For non-channel owners, proceed with regular permission check
    const permissionResult = await checkChannelModPermissions({
        channelConnections: [channelUniqueName],
        context,
        permissionCheck: ModChannelPermission.canSuspendUser
    });
    
    // If the user does not have the required permission, return an error
    if (permissionResult instanceof Error) {
        return permissionResult;
    }
    
    // If the user has the required permission, return true
    return true;
}
);
