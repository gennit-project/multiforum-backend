/** Exact native query containers. Only suspendedUntil is converted by Cypher;
 * stored identity, issue and indefinite-flag properties remain untrusted. */
export type ServerSuspensionCore = {
  id: unknown;
  username: unknown;
  modProfileName: unknown;
  channelUniqueName: unknown;
  serverName: unknown;
  suspendedUntil: string | null;
  suspendedIndefinitely: unknown;
  RelatedIssue: { id: unknown; issueNumber: unknown } | null;
};
export type ServerUserSuspensionSource = ServerSuspensionCore & {
  SuspendedUser: { username: unknown } | null;
};
export type ServerModSuspensionSource = ServerSuspensionCore & {
  SuspendedMod: { displayName: unknown } | null;
};
export type ServerSuspensionSource = ServerUserSuspensionSource | ServerModSuspensionSource;
