import type { ServerSuspensionSource } from "../../customResolvers/contracts/serverSuspensionSource.js";

export type ActiveServerSuspensionResult = {
  activeSuspension: ServerSuspensionSource | null;
  isSuspended: boolean;
  relatedIssueId: unknown;
  relatedIssueNumber: unknown;
  expiredUserSuspensions: ServerSuspensionSource[];
  expiredModSuspensions: ServerSuspensionSource[];
  suspendedEntity: "user" | "mod" | null;
};
