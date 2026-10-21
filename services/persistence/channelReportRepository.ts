import type { Driver } from "neo4j-driver";
import type { IssueCreateInput, IssueUpdateInput, IssueWhere } from "../../src/generated/graphql.js";
import { attachIssueIdentityRelationships, assertIssueIdentityUpdateAllowed } from "../issueTargetIdentity.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";

export type ChannelReportIssue = { id: string; issueNumber: number; flaggedServerRuleViolation?: boolean | null; relatedChannelUniqueName?: string | null };
export interface ChannelReportRepository {
  findExisting(channelUniqueName: string): Promise<ChannelReportIssue[]>;
  findChannel(channelUniqueName: string): Promise<Array<{uniqueName: string; displayName?: string | null}>>;
  createIssue(input: IssueCreateInput): Promise<{issues: ChannelReportIssue[]}>;
  appendReport(where: IssueWhere, update: IssueUpdateInput): Promise<{issues: ChannelReportIssue[]}>;
}
const ISSUE_FIELDS = `id issueNumber flaggedServerRuleViolation`;
export function createChannelReportRepository(driver: Driver): ChannelReportRepository {
  return {
    async findExisting(channelUniqueName) {
      const result = await executeGeneratedOperation<{issues: ChannelReportIssue[]}>(driver,
        `query ExistingChannelReport($where: IssueWhere) { issues(where: $where) { ${ISSUE_FIELDS} } }`,
        {where: {channelUniqueName: null, relatedChannelUniqueName: channelUniqueName}});
      return result.issues;
    },
    async findChannel(channelUniqueName) {
      const result = await executeGeneratedOperation<{channels: Array<{uniqueName: string; displayName?: string | null}>}>(driver,
        `query ReportedChannelDisplayName($where: ChannelWhere) { channels(where: $where) { uniqueName displayName } }`, {where: {uniqueName: channelUniqueName}});
      return result.channels;
    },
    async createIssue(input) {
      const result = await executeGeneratedOperation<{createIssues: {issues: ChannelReportIssue[]}}>(driver,
        `mutation CreateChannelReport($input: [IssueCreateInput!]!) { createIssues(input: $input) { issues { ${ISSUE_FIELDS} } } }`,
        {input: [attachIssueIdentityRelationships(input)]});
      return result.createIssues;
    },
    async appendReport(where, update) {
      assertIssueIdentityUpdateAllowed(update);
      const result = await executeGeneratedOperation<{updateIssues: {issues: ChannelReportIssue[]}}>(driver,
        `mutation AppendChannelReport($where: IssueWhere, $update: IssueUpdateInput) { updateIssues(where: $where, update: $update) { issues { ${ISSUE_FIELDS} relatedChannelUniqueName } } }`,
        {where, update});
      return result.updateIssues;
    },
  };
}
