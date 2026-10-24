import type { Driver } from "neo4j-driver";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import {
  createModerationIssue,
  appendModerationActions,
  type CreateModerationIssueParams,
  type AppendModerationActionsParams,
} from "./moderationIssueWrites.js";

export type ChannelReportIssue = { id: string; issueNumber: number; flaggedServerRuleViolation?: boolean | null; relatedChannelUniqueName?: string | null };
export interface ChannelReportRepository {
  findExisting(channelUniqueName: string): Promise<ChannelReportIssue[]>;
  findChannel(channelUniqueName: string): Promise<Array<{uniqueName: string; displayName?: string | null}>>;
  // FAMILY-3 / v7 (campaign #284): Issue + ModerationAction + Comment writes are
  // owned Cypher (moderationIssueWrites); reads stay on the generated API.
  createIssue(params: CreateModerationIssueParams): Promise<{issues: ChannelReportIssue[]}>;
  appendReport(params: AppendModerationActionsParams): Promise<{issues: ChannelReportIssue[]}>;
}
export function createChannelReportRepository(driver: Driver): ChannelReportRepository {
  return {
    async findExisting(channelUniqueName) {
      const result = await executeGeneratedOperation<{issues: ChannelReportIssue[]}>(driver,
        `query ExistingChannelReport($where: IssueWhere) { issues(where: $where) { id issueNumber flaggedServerRuleViolation } }`,
        {where: {channelUniqueName: {eq: null}, relatedChannelUniqueName: {eq: channelUniqueName}}});
      return result.issues;
    },
    async findChannel(channelUniqueName) {
      const result = await executeGeneratedOperation<{channels: Array<{uniqueName: string; displayName?: string | null}>}>(driver,
        `query ReportedChannelDisplayName($where: ChannelWhere) { channels(where: $where) { uniqueName displayName } }`, {where: {uniqueName: {eq: channelUniqueName}}});
      return result.channels;
    },
    async createIssue(params) {
      const issue = await createModerationIssue(driver, params);
      return { issues: [issue as ChannelReportIssue] };
    },
    async appendReport(params) {
      const result = await appendModerationActions(driver, params);
      return { issues: result.issues as ChannelReportIssue[] };
    },
  };
}
