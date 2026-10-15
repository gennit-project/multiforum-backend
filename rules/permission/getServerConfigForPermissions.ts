import { getPermissionRequestCache } from "./getPermissionRequestCache.js";
import type { GraphQLContext } from "../../types/context.js";
import {
  createPermissionServerConfigRepository,
  type PermissionServerConfigRepository,
} from "../../services/persistence/permissionServerConfigRepository.js";

export const getServerConfigForPermissions = async (
  context: GraphQLContext,
  repository: PermissionServerConfigRepository =
    context.permissionServerConfigRepository ??
    createPermissionServerConfigRepository(context.driver)
) => {
  const cache = getPermissionRequestCache(context);

  if (!cache.serverConfigPromise) {
    cache.serverConfigPromise = repository.findByName(
      process.env.SERVER_CONFIG_NAME
    );
  }

  return cache.serverConfigPromise;
};
