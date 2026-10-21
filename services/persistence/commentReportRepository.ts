import type { Driver } from "neo4j-driver";
import type { IssueCreateInput, IssueUpdateInput, IssueWhere } from "../../src/generated/graphql.js";
import { attachIssueIdentityRelationships, assertIssueIdentityUpdateAllowed } from "../issueTargetIdentity.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";

export type CommentReportIssue = { id: string; issueNumber: number; flaggedServerRuleViolation?: boolean | null };
export interface CommentReportRepository {
  findExisting(channelUniqueName: string, commentId: string): Promise<CommentReportIssue[]>;
  findComment(commentId: string): Promise<Array<ReportedComment>>;
  createIssue(input: IssueCreateInput): Promise<{issues: CommentReportIssue[]}>;
  appendReport(where: IssueWhere, update: IssueUpdateInput): Promise<{issues: CommentReportIssue[]}>;
}
type ReportedComment = { id: string; text?: string | null; CommentAuthor?: {__typename?: "User"; username?: string | null} | {__typename?: "ModerationProfile"; displayName?: string | null} | null };
const ISSUE_FIELDS = `id issueNumber flaggedServerRuleViolation`;
export function createCommentReportRepository(driver: Driver): CommentReportRepository {
  return {
    async findExisting(channelUniqueName, commentId) {
      const result = await executeGeneratedOperation<{issues: CommentReportIssue[]}>(driver,
        `query ExistingCommentReport($where: IssueWhere) { issues(where: $where) { ${ISSUE_FIELDS} relatedUsername relatedModProfileName } }`,
        {where: {channelUniqueName, relatedCommentId: commentId}});
      return result.issues;
    },
    async findComment(commentId) {
      const result = await executeGeneratedOperation<{comments: Array<ReportedComment>}>(driver,
        `query ReportedCommentAuthor($where: CommentWhere) { comments(where: $where) { id text CommentAuthor { __typename ... on User { username } ... on ModerationProfile { displayName } } } }`, {where: {id: commentId}});
      return result.comments;
    },
    async createIssue(input) {
      const result = await executeGeneratedOperation<{createIssues: {issues: CommentReportIssue[]}}>(driver,
        `mutation CreateCommentReport($input: [IssueCreateInput!]!) { createIssues(input: $input) { issues { ${ISSUE_FIELDS} } } }`,
        {input: [attachIssueIdentityRelationships(input)]});
      return result.createIssues;
    },
    async appendReport(where, update) {
      assertIssueIdentityUpdateAllowed(update);
      const result = await executeGeneratedOperation<{updateIssues: {issues: CommentReportIssue[]}}>(driver,
        `mutation AppendCommentReport($where: IssueWhere, $update: IssueUpdateInput) { updateIssues(where: $where, update: $update) { issues { ${ISSUE_FIELDS} } } }`,
        {where, update});
      return result.updateIssues;
    },
  };
}
