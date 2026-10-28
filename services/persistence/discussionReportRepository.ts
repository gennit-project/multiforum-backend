import type { Driver } from "neo4j-driver";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import {
  createModerationIssue,
  appendModerationActions,
  type CreateModerationIssueParams,
  type AppendModerationActionsParams,
} from "./moderationIssueWrites.js";

export type DiscussionReportIssue = { id: string; issueNumber: number; flaggedServerRuleViolation?: boolean | null };
export interface DiscussionReportRepository {
  findExisting(channelUniqueName: string, discussionId: string): Promise<DiscussionReportIssue[]>;
  findDiscussion(discussionId: string): Promise<Array<{id: string; title?: string | null}>>;
  findChannel(channelUniqueName: string): Promise<Array<{uniqueName: string}>>;
  // FAMILY-3 / v7 (campaign #284): Issue + ModerationAction + Comment writes are
  // owned Cypher (moderationIssueWrites); reads stay on the generated API.
  createIssue(params: CreateModerationIssueParams): Promise<{issues: DiscussionReportIssue[]}>;
  appendReport(params: AppendModerationActionsParams): Promise<{issues: DiscussionReportIssue[]}>;
}
const ISSUE_FIELDS = `id issueNumber flaggedServerRuleViolation`;
export function createDiscussionReportRepository(driver: Driver): DiscussionReportRepository {
  return {
    async findExisting(channelUniqueName, discussionId) {
      const result = await executeGeneratedOperation<{issues: DiscussionReportIssue[]}>(driver,
        `query ExistingDiscussionReport($where: IssueWhere) { issues(where: $where) { ${ISSUE_FIELDS} } }`,
        {where: {relatedDiscussionId: {eq: discussionId}, channelUniqueName: {eq: channelUniqueName}}});
      return result.issues;
    },
    async findDiscussion(discussionId) {
      const result = await executeGeneratedOperation<{discussions: Array<{id: string; title?: string | null}>}>(driver,
        `query ReportedDiscussionTitle($where: DiscussionWhere) { discussions(where: $where) { id title } }`, {where: {id: {eq: discussionId}}});
      return result.discussions;
    },
    async findChannel(channelUniqueName) {
      const result = await executeGeneratedOperation<{channels: Array<{uniqueName: string}>}>(driver,
        `query DiscussionReportChannel($where: ChannelWhere) { channels(where: $where) { uniqueName } }`, {where: {uniqueName: {eq: channelUniqueName}}});
      return result.channels;
    },
    async createIssue(params) {
      const issue = await createModerationIssue(driver, params);
      return { issues: [issue as DiscussionReportIssue] };
    },
    async appendReport(params) {
      const result = await appendModerationActions(driver, params);
      return { issues: result.issues as DiscussionReportIssue[] };
    },
  };
}
