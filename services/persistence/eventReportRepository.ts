import type { Driver } from "neo4j-driver";
import type { IssueCreateInput, IssueUpdateInput, IssueWhere } from "../../src/generated/graphql.js";
import { attachIssueIdentityRelationships, assertIssueIdentityUpdateAllowed } from "../issueTargetIdentity.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";

export type EventReportIssue = { id: string; issueNumber: number; flaggedServerRuleViolation?: boolean | null };
export interface EventReportRepository {
  findExisting(channelUniqueName: string, eventId: string): Promise<EventReportIssue[]>;
  findEvent(eventId: string): Promise<Array<{id: string; title?: string | null}>>;
  createIssue(input: IssueCreateInput): Promise<{issues: EventReportIssue[]}>;
  appendReport(where: IssueWhere, update: IssueUpdateInput): Promise<{issues: EventReportIssue[]}>;
}
const ISSUE_FIELDS = `id issueNumber flaggedServerRuleViolation`;
export function createEventReportRepository(driver: Driver): EventReportRepository {
  return {
    async findExisting(channelUniqueName, eventId) {
      const result = await executeGeneratedOperation<{issues: EventReportIssue[]}>(driver,
        `query ExistingEventReport($where: IssueWhere) { issues(where: $where) { ${ISSUE_FIELDS} } }`,
        {where: {channelUniqueName, relatedEventId: eventId}});
      return result.issues;
    },
    async findEvent(eventId) {
      const result = await executeGeneratedOperation<{events: Array<{id: string; title?: string | null}>}>(driver,
        `query ReportedEventTitle($where: EventWhere) { events(where: $where) { id title } }`, {where: {id: eventId}});
      return result.events;
    },
    async createIssue(input) {
      const result = await executeGeneratedOperation<{createIssues: {issues: EventReportIssue[]}}>(driver,
        `mutation CreateEventReport($input: [IssueCreateInput!]!) { createIssues(input: $input) { issues { ${ISSUE_FIELDS} } } }`,
        {input: [attachIssueIdentityRelationships(input)]});
      return result.createIssues;
    },
    async appendReport(where, update) {
      assertIssueIdentityUpdateAllowed(update);
      const result = await executeGeneratedOperation<{updateIssues: {issues: EventReportIssue[]}}>(driver,
        `mutation AppendEventReport($where: IssueWhere, $update: IssueUpdateInput) { updateIssues(where: $where, update: $update) { issues { ${ISSUE_FIELDS} } } }`,
        {where, update});
      return result.updateIssues;
    },
  };
}
