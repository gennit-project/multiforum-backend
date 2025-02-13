import { setUserDataOnContext } from "./userDataHelperFunctions.js";
import { ERROR_MESSAGES } from "../errorMessages.js";
import { ChannelRole } from "../../ogm_types.js";

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

  // 1. Check for server roles on the user object.
  context.user = await setUserDataOnContext({
    context,
    getPermissionInfo: true,
    checkSpecificChannel: channelName,
  });

  const usersServerRoles = context.user?.data?.ServerRoles || [];

  // 2. If there is at least one server role on the user
  //    object, loop over them. All of them must explicitly
  //    allow the permission. Otherwise, if one says false
  //    or is not mentioned, return false.
  if (usersServerRoles.length > 0) {
    for (const serverRole of usersServerRoles) {
      if (!serverRole[permission]) {
        // We check if the user has been suspended
        // from the server and reject the request if so.
        return new Error(ERROR_MESSAGES.server.noServerPermission);
      }
    }
  }

  // 3. Check the user's channel roles.
  // Get the list of channel roles on the user object.
  const channelRoles = context.user?.data?.ChannelRoles || [];

  if (channelRoles.length > 0) {
    for (const channelRole of channelRoles) {
      if (!channelRole[permission]) {
        // We check if the user has been suspended
        // from the channel and reject the request if so.
        return new Error(ERROR_MESSAGES.server.noServerPermission);
      }
    }
  }

  // 4. If there are no channel roles on the user object,
  // get the default channel role. This is located on the
  // Channel object.
  // We will allow the action only if the action is allowed
  // by the default channel role AND the default server role.
  if (!channelRoles.length) {
    const channel = await Channel.find({
      where: {
        uniqueName: channelName,
      },
      selectionSet: `{ 
            DefaultChannelRole { 
              canCreateEvent
              canCreateDiscussion
              canCreateComment
              canUpvoteComment
              canUpvoteDiscussion
            } 
          }`,
    });

    // @ts-ignore
    const defaultChannelRole = channel[0]?.DefaultChannelRole;

    if (defaultChannelRole) {
      channelRoles.push(defaultChannelRole);
    }
  }

  // Loop over the list of channel roles. They all
  // must explicitly allow the permission.
  // Otherwise, if one says false or is missing
  // the permission, return false.
  for (const channelRole of channelRoles) {
    if (!channelRole.includes(permission)) {
      return false;
    }
  }

  // 5. We check if the user has been suspended
  // from the server and reject the request if so.
  const ServerConfig = context.ogm.model("ServerConfig");
  const serverConfig = await ServerConfig.find({
    where: { serverName: process.env.SERVER_CONFIG_NAME },
    selectionSet: `{ DefaultServerRole { 
        canCreateChannel
        canCreateEvent
        canCreateDiscussion
        canCreateComment
        canUpvoteComment
        canUpvoteDiscussion
      } 
    }`,
  });

  if (!serverConfig || !serverConfig[0]) {
    return new Error(
      "While checking forum permissions, could not find the server config, which contains the default server role. Therefore could not check the user's permissions."
    );
  }

  const defaultServerRole = serverConfig[0]?.DefaultServerRole;

  if (!defaultServerRole) {
    return new Error("Could not find the default server role.");
  }

  usersServerRoles.push(defaultServerRole);

  // Error handling: Make sure we could successfully fetch the
  // default server role. If not, return an error.
  if (!usersServerRoles[0]) {
    return new Error(
      "Could not find permission on user's role or on the default server role."
    );
  }

  // Check if the permission is allowed by the default
  //    server role.
  const serverRoleToCheck = usersServerRoles[0];

  if (permission === "canCreateDiscussion") {
    return !!serverRoleToCheck.canCreateDiscussion;
  }
  if (permission === "canCreateEvent") {
    return !!serverRoleToCheck.canCreateEvent;
  }
  if (permission === "canCreateComment") {
    return !!serverRoleToCheck.canCreateComment;
  }
  if (permission === "canUpvoteComment") {
    return !!serverRoleToCheck.canUpvoteComment;
  }
  if (permission === "canUpvoteDiscussion") {
    return !!serverRoleToCheck.canUpvoteDiscussion;
  }
  return new Error(ERROR_MESSAGES.generic.noPermission);
};

type CheckChannelPermissionInput = {
  channelConnections: string[];
  context: any;
  permissionCheck: keyof ChannelRole;
};


// Helper function to check channel permissions
export async function checkChannelPermissions(
  input: CheckChannelPermissionInput
) {
  const { channelConnections, context, permissionCheck } = input;

  for (const channelConnection of channelConnections) {
    const permissionResult = await hasChannelPermission({
      permission: permissionCheck,
      channelName: channelConnection,
      context: context,
    });

    if (!permissionResult) {
      return new Error("The user does not have permission in this channel.");
    }

    if (permissionResult instanceof Error) {
      return permissionResult;
    }
  }

  return true;
}