import { getPermissionRequestCache } from "./getPermissionRequestCache.js";

export const getServerConfigForPermissions = async (context: any) => {
  const cache = getPermissionRequestCache(context);

  if (!cache.serverConfigPromise) {
    const ServerConfig = context.ogm.model("ServerConfig");
    cache.serverConfigPromise = ServerConfig.find({
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
        Admins {
          username
        }
        Moderators {
          displayName
        }
      }`,
    }).then((serverConfigs: any[]) => serverConfigs?.[0] ?? null);
  }

  return cache.serverConfigPromise;
};
