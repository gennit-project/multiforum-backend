import type { Driver } from "neo4j-driver";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import {
  createModerationIssue,
  appendModerationActions,
  type CreateModerationIssueParams,
  type AppendModerationActionsParams,
} from "./moderationIssueWrites.js";

export type EventReportIssue = { id: string; issueNumber: number; flaggedServerRuleViolation?: boolean | null };
export interface EventReportRepository {
  findExisting(channelUniqueName: string, eventId: string): Promise<EventReportIssue[]>;
  findEvent(eventId: string): Promise<Array<{id: string; title?: string | null}>>;
  // FAMILY-3 / v7 (campaign #284): Issue + ModerationAction + Comment writes are
  // owned Cypher (moderationIssueWrites); reads stay on the generated API.
  createIssue(params: CreateModerationIssueParams): Promise<{issues: EventReportIssue[]}>;
  appendReport(params: AppendModerationActionsParams): Promise<{issues: EventReportIssue[]}>;
}
const ISSUE_FIELDS = `id issueNumber flaggedServerRuleViolation`;
export function createEventReportRepository(driver: Driver): EventReportRepository {
  return {
    async findExisting(channelUniqueName, eventId) {
      const result = await executeGeneratedOperation<{issues: EventReportIssue[]}>(driver,
        `query ExistingEventReport($where: IssueWhere) { issues(where: $where) { ${ISSUE_FIELDS} } }`,
        {where: {channelUniqueName: {eq: channelUniqueName}, relatedEventId: {eq: eventId}}});
      return result.issues;
    },
    async findEvent(eventId) {
      const result = await executeGeneratedOperation<{events: Array<{id: string; title?: string | null}>}>(driver,
        `query ReportedEventTitle($where: EventWhere) { events(where: $where) { id title } }`, {where: {id: {eq: eventId}}});
      return result.events;
    },
    async createIssue(params) {
      const issue = await createModerationIssue(driver, params);
      return { issues: [issue as EventReportIssue] };
    },
    async appendReport(params) {
      const result = await appendModerationActions(driver, params);
      return { issues: result.issues as EventReportIssue[] };
    },
  };
}
