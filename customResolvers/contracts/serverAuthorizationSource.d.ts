// Native Cypher constructs these containers, but does not complete their
// property values through GraphQL scalar validation.
export type RawServerCapabilities = Record<string, unknown>;
export type NativeServerAuthorizationSnapshot = {
  enableDownloads: unknown;
  DefaultServerRole: RawServerCapabilities | null;
  DefaultSuspendedRole: RawServerCapabilities | null;
  DefaultAdminRole: RawServerCapabilities | null;
  DefaultSuperAdminRole: RawServerCapabilities | null;
  DefaultModRole: RawServerCapabilities | null;
  DefaultElevatedModRole: RawServerCapabilities | null;
  DefaultSuspendedModRole: RawServerCapabilities | null;
  SuperAdmins: Array<{ username: unknown }>;
  Admins: Array<{ username: unknown }>;
  Moderators: Array<{ displayName: unknown }>;
  // Legacy suspension conversion is not certified by this authorization slice.
  SuspendedUsers: unknown[];
  SuspendedMods: unknown[];
};
export type ServerAuthorizationRecord = {
  serverConfig: NativeServerAuthorizationSnapshot;
};
