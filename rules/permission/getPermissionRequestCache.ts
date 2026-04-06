type PermissionRequestCache = {
  serverConfigPromise?: Promise<any>;
  activeServerSuspensionByUsername: Map<string, Promise<boolean>>;
};

export const getPermissionRequestCache = (
  context: any
): PermissionRequestCache => {
  if (!context.__permissionRequestCache) {
    context.__permissionRequestCache = {
      activeServerSuspensionByUsername: new Map(),
    };
  }

  return context.__permissionRequestCache as PermissionRequestCache;
};
