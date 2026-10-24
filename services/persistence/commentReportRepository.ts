import type { Driver } from "neo4j-driver";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import {
  createModerationIssue,
  appendModerationActions,
  type CreateModerationIssueParams,
  type AppendModerationActionsParams,
} from "./moderationIssueWrites.js";

export type CommentReportIssue = { id: string; issueNumber: number; flaggedServerRuleViolation?: boolean | null };
export interface CommentReportRepository {
  findExisting(channelUniqueName: string, commentId: string): Promise<CommentReportIssue[]>;
  findComment(commentId: string): Promise<Array<ReportedComment>>;
  // FAMILY-3 / v7 (campaign #284): the Issue + ModerationAction + Comment writes
  // are owned Cypher (moderationIssueWrites) instead of generated mutations with
  // the removed to-one connect inputs. Reads stay on the generated API.
  createIssue(params: CreateModerationIssueParams): Promise<{issues: CommentReportIssue[]}>;
  appendReport(params: AppendModerationActionsParams): Promise<{issues: CommentReportIssue[]}>;
}
type ReportedComment = { id: string; text?: string | null; CommentAuthor?: {__typename?: "User"; username?: string | null} | {__typename?: "ModerationProfile"; displayName?: string | null} | null };
const ISSUE_FIELDS = `id issueNumber flaggedServerRuleViolation`;
export function createCommentReportRepository(driver: Driver): CommentReportRepository {
  return {
    async findExisting(channelUniqueName, commentId) {
      const result = await executeGeneratedOperation<{issues: CommentReportIssue[]}>(driver,
        `query ExistingCommentReport($where: IssueWhere) { issues(where: $where) { ${ISSUE_FIELDS} relatedUsername relatedModProfileName } }`,
        {where: {channelUniqueName: {eq: channelUniqueName}, relatedCommentId: {eq: commentId}}});
      return result.issues;
    },
    async findComment(commentId) {
      const result = await executeGeneratedOperation<{comments: Array<ReportedComment>}>(driver,
        `query ReportedCommentAuthor($where: CommentWhere) { comments(where: $where) { id text CommentAuthor { __typename ... on User { username } ... on ModerationProfile { displayName } } } }`, {where: {id: {eq: commentId}}});
      return result.comments;
    },
    async createIssue(params) {
      const issue = await createModerationIssue(driver, params);
      return { issues: [issue as CommentReportIssue] };
    },
    async appendReport(params) {
      const result = await appendModerationActions(driver, params);
      return { issues: result.issues as CommentReportIssue[] };
    },
  };
}
