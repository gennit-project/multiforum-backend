import type { Driver } from "neo4j-driver";
import type { IssueCreateInput, IssueUpdateInput, IssueWhere } from "../../src/generated/graphql.js";
import { attachIssueIdentityRelationships, assertIssueIdentityUpdateAllowed } from "../issueTargetIdentity.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";

export type DiscussionReportIssue = { id: string; issueNumber: number; flaggedServerRuleViolation?: boolean | null };
export interface DiscussionReportRepository {
  findExisting(channelUniqueName: string, discussionId: string): Promise<DiscussionReportIssue[]>;
  findDiscussion(discussionId: string): Promise<Array<{id: string; title?: string | null}>>;
  findChannel(channelUniqueName: string): Promise<Array<{uniqueName: string}>>;
  createIssue(input: IssueCreateInput): Promise<{issues: DiscussionReportIssue[]}>;
  appendReport(where: IssueWhere, update: IssueUpdateInput): Promise<{issues: DiscussionReportIssue[]}>;
}
const ISSUE_FIELDS = `id issueNumber flaggedServerRuleViolation`;
export function createDiscussionReportRepository(driver: Driver): DiscussionReportRepository {
  return {
    async findExisting(channelUniqueName, discussionId) {
      const result = await executeGeneratedOperation<{issues: DiscussionReportIssue[]}>(driver,
        `query ExistingDiscussionReport($where: IssueWhere) { issues(where: $where) { ${ISSUE_FIELDS} } }`,
        {where: {relatedDiscussionId: discussionId, channelUniqueName}});
      return result.issues;
    },
    async findDiscussion(discussionId) {
      const result = await executeGeneratedOperation<{discussions: Array<{id: string; title?: string | null}>}>(driver,
        `query ReportedDiscussionTitle($where: DiscussionWhere) { discussions(where: $where) { id title } }`, {where: {id: discussionId}});
      return result.discussions;
    },
    async findChannel(channelUniqueName) {
      const result = await executeGeneratedOperation<{channels: Array<{uniqueName: string}>}>(driver,
        `query DiscussionReportChannel($where: ChannelWhere) { channels(where: $where) { uniqueName } }`, {where: {uniqueName: channelUniqueName}});
      return result.channels;
    },
    async createIssue(input) {
      const result = await executeGeneratedOperation<{createIssues: {issues: DiscussionReportIssue[]}}>(driver,
        `mutation CreateDiscussionReport($input: [IssueCreateInput!]!) { createIssues(input: $input) { issues { ${ISSUE_FIELDS} } } }`,
        {input: [attachIssueIdentityRelationships(input)]});
      return result.createIssues;
    },
    async appendReport(where, update) {
      assertIssueIdentityUpdateAllowed(update);
      const result = await executeGeneratedOperation<{updateIssues: {issues: DiscussionReportIssue[]}}>(driver,
        `mutation AppendDiscussionReport($where: IssueWhere, $update: IssueUpdateInput) { updateIssues(where: $where, update: $update) { issues { ${ISSUE_FIELDS} } } }`,
        {where, update});
      return result.updateIssues;
    },
  };
}
