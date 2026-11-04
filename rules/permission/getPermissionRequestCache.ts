import type {PermissionServerConfig} from "../../services/persistence/permissionServerConfigRepository.js";
import type { GraphQLContext } from "../../types/context.js";
import type { ActiveServerSuspensionResult } from "./activeServerSuspensionTypes.js";

type PermissionRequestCache = {
  // Preserve the fixed permission snapshot instead of erasing it in the cache.
  serverConfigPromise?: Promise<PermissionServerConfig | null>;
  // Memoized server-suspension lookups, keyed by the exact
  // `[username, modProfileName]` tuple (see getActiveServerSuspension).
  // Request-scoped only.
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

  return context.__permissionRequestCache;
};
