import type { Suspension } from "../../ogm_types.js";

export type ActiveServerSuspensionResult = {
  activeSuspension: Suspension | null;
  isSuspended: boolean;
  relatedIssueId: string | null;
  relatedIssueNumber: number | null;
  expiredUserSuspensions: Suspension[];
  expiredModSuspensions: Suspension[];
  suspendedEntity: "user" | "mod" | null;
};
