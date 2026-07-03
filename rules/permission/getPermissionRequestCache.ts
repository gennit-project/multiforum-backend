import type { GraphQLContext } from "../../types/context.js";
import type { ActiveServerSuspensionResult } from "./getActiveServerSuspension.js";

type PermissionRequestCache = {
  // Holds the cached ServerConfig lookup. Kept as `any` because downstream
  // permission checks read many dynamically-selected fields off the result.
  serverConfigPromise?: Promise<any>;
  // Memoized server-suspension lookups, keyed by `username|modProfileName`
  // (see getActiveServerSuspension). Request-scoped only.
  activeServerSuspensionByKey: Map<string, Promise<ActiveServerSuspensionResult>>;
};

type ContextWithPermissionCache = GraphQLContext & {
  __permissionRequestCache?: PermissionRequestCache;
};

export const getPermissionRequestCache = (
  context: ContextWithPermissionCache
): PermissionRequestCache => {
  if (!context.__permissionRequestCache) {
    context.__permissionRequestCache = {
      activeServerSuspensionByKey: new Map(),
    };
  }

  return context.__permissionRequestCache as PermissionRequestCache;
};
