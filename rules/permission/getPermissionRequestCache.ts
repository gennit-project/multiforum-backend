import type { GraphQLContext } from "../../types/context.js";

type PermissionRequestCache = {
  // Holds the cached ServerConfig lookup. Kept as `any` because downstream
  // permission checks read many dynamically-selected fields off the result.
  serverConfigPromise?: Promise<any>;
  activeServerSuspensionByUsername: Map<string, Promise<boolean>>;
};

type ContextWithPermissionCache = GraphQLContext & {
  __permissionRequestCache?: PermissionRequestCache;
};

export const getPermissionRequestCache = (
  context: ContextWithPermissionCache
): PermissionRequestCache => {
  if (!context.__permissionRequestCache) {
    context.__permissionRequestCache = {
      activeServerSuspensionByUsername: new Map(),
    };
  }

  return context.__permissionRequestCache as PermissionRequestCache;
};
