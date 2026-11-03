import type { Driver } from "neo4j-driver";
import { appendModerationActions, type AppendModerationActionsParams, type ModerationIssueRow, type OpenModerationIssueRow } from "./moderationIssueWrites.js";
/** Bind the shared write while retaining its non-null isOpen provenance. */
export function archiveIssueAppender(driver: Driver) {
 function append(params: AppendModerationActionsParams & {isOpen:boolean}): Promise<{issues:OpenModerationIssueRow[]}>;
 function append(params: AppendModerationActionsParams): Promise<{issues:ModerationIssueRow[]}>;
 function append(params: AppendModerationActionsParams): Promise<{issues:ModerationIssueRow[]}> {
  return appendModerationActions(driver,params);
 }
 return append;
}
export type ArchiveIssueAppender = ReturnType<typeof archiveIssueAppender>;
