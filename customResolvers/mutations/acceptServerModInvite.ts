import type {
  ServerConfigUpdateInput,
  ServerConfigModel,
  UserModel,
} from "../../ogm_types.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";

type Args = {
  serverName: string;
};

type Input = {
  ServerConfig: ServerConfigModel;
  User: UserModel;
};

const getResolver = (input: Input) => {
  const { ServerConfig, User } = input;
  return async (parent: any, args: Args, context: any, resolveInfo: any) => {
    const { serverName } = args;
    if (!serverName) {
      throw new Error("All arguments (serverName) are required");
    }

    // Set loggedInUsername to null explicitly if not present
    context.user = await setUserDataOnContext({
      context,
      getPermissionInfo: false,
    });

    const loggedInUsername = context.user?.username || null;

    if (!loggedInUsername) {
      throw new Error("User must be logged in");
    }

    // Get mod name from username
    const userData = await User.find({
      where: {
        username: loggedInUsername,
      },
      selectionSet: `{
        ModerationProfile {
          displayName
        }
      }`,
    });
    const displayName = userData[0]?.ModerationProfile?.displayName || null;
    if (!displayName) {
      throw new Error(`User ${loggedInUsername} is not a moderator`);
    }

    // Check if there's a pending mod invite first
    const serverConfigWithPendingInvite = await ServerConfig.find({
      where: {
        serverName: serverName,
      },
      selectionSet: `{
        PendingModInvites {
          username
        }
      }`,
    });

    // Note: Using type assertion until OGM types are regenerated
    const serverConfig = serverConfigWithPendingInvite[0] as any;
    if (!serverConfig?.PendingModInvites?.some(
      (invite: { username: string }) => invite.username === loggedInUsername
    )) {
      throw new Error(`No pending moderator invite found for user ${loggedInUsername}`);
    }

    // Note: Using type assertion until OGM types are regenerated
    const addServerModInput = {
      Moderators: [
        {
          connect: [
            {
              where: {
                node: {
                  displayName,
                },
              },
            },
          ],
        },
      ],
    } as ServerConfigUpdateInput;

    // Note: Using type assertion until OGM types are regenerated
    const removePendingInviteInput = {
      PendingModInvites: [
        {
          disconnect: [
            {
              where: {
                node: {
                  username: loggedInUsername,
                },
              },
            },
          ],
        },
      ],
    } as ServerConfigUpdateInput;

    try {
      const acceptInviteResult = await ServerConfig.update({
        where: {
          serverName: serverName,
        },
        update: addServerModInput,
      });
      if (!acceptInviteResult.serverConfigs[0]) {
        throw new Error("ServerConfig not found. Could not accept invite.");
      }
      const removePendingInviteResult = await ServerConfig.update({
        where: {
          serverName: serverName,
        },
        update: removePendingInviteInput,
      });
      if (!removePendingInviteResult.serverConfigs[0]) {
        throw new Error("ServerConfig not found. Could not remove pending invite");
      }
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  };
};

export default getResolver;
