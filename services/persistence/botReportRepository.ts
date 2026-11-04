import type { Driver } from "neo4j-driver";
import type { Issue, IssueWhere } from "../../ogm_types.js";
import type {BotExistingReport,BotReportedComment,BotReportedDiscussion,BotReportedEvent} from "../../customResolvers/contracts/botReportProjections.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import {
  createModerationIssue,
  appendModerationActions,
  type CreateModerationIssueParams,
  type ReportModerationIssueRow,
  type AppendModerationActionsParams,
} from "./moderationIssueWrites.js";
export const FINDEXISTINGREPORT_SELECTION = `{
      id
      issueNumber
      flaggedServerRuleViolation
      relatedUsername
      relatedModProfileName
    }`;
export const FINDREPORTEDCOMMENT_SELECTION = `{
          id
          text
          CommentAuthor {
            __typename
            ... on User {
              username
            }
            ... on ModerationProfile {
              displayName
            }
          }
        }`;
export const FINDREPORTEDDISCUSSION_SELECTION = `{
          id
          title
          Author {
            username
          }
        }`;
export const FINDREPORTEDEVENT_SELECTION = `{
          id
          title
          Poster {
            username
          }
        }`;
export interface BotReportRepository {
  findExistingReport(where: IssueWhere): Promise<BotExistingReport[]>;
  findIdempotentReport(where: IssueWhere, idempotencyKey: string): Promise<BotExistingReport[]>;
  findReportedComment(id: string): Promise<BotReportedComment[]>;
  findReportedDiscussion(id: string): Promise<BotReportedDiscussion[]>;
  findReportedEvent(id: string): Promise<BotReportedEvent[]>;
  // FAMILY-3 / v7 (campaign #284): Issue + ModerationAction + Comment writes are
  // owned Cypher (moderationIssueWrites); reads stay on the generated API.
  createReportedIssue(params: CreateModerationIssueParams[]): Promise<{issues:ReportModerationIssueRow[]}>;
  appendBotReport(params: AppendModerationActionsParams): Promise<{issues:Issue[]}>;
}
export function createBotReportRepository(driver: Driver): BotReportRepository {
  return {
    async findExistingReport(where) {
      const result = await executeGeneratedOperation<{issues:BotExistingReport[]}>(driver,
        `query BotReport_findExistingReport($where: IssueWhere) { issues(where: $where) ${FINDEXISTINGREPORT_SELECTION} }`, {where});
      return result.issues;
    },
    async findIdempotentReport(where, idempotencyKey) {
      const result = await executeGeneratedOperation<{issues:BotExistingReport[]}>(driver,
        `query BotReport_findIdempotentReport($where: IssueWhere) { issues(where: $where) ${FINDEXISTINGREPORT_SELECTION} }`, {
          where: {
            ...where,
            ActivityFeed: { some: { idempotencyKey: { eq: idempotencyKey } } },
          },
        });
      return result.issues;
    },
    async findReportedComment(id) {
      const result = await executeGeneratedOperation<{comments:BotReportedComment[]}>(driver,
        `query BotReport_findReportedComment($where: CommentWhere) { comments(where: $where) ${FINDREPORTEDCOMMENT_SELECTION} }`, {where:{id:{eq:id}}});
      return result.comments;
    },
    async findReportedDiscussion(id) {
      const result = await executeGeneratedOperation<{discussions:BotReportedDiscussion[]}>(driver,
        `query BotReport_findReportedDiscussion($where: DiscussionWhere) { discussions(where: $where) ${FINDREPORTEDDISCUSSION_SELECTION} }`, {where:{id:{eq:id}}});
      return result.discussions;
    },
    async findReportedEvent(id) {
      const result = await executeGeneratedOperation<{events:BotReportedEvent[]}>(driver,
        `query BotReport_findReportedEvent($where: EventWhere) { events(where: $where) ${FINDREPORTEDEVENT_SELECTION} }`, {where:{id:{eq:id}}});
      return result.events;
    },
    async createReportedIssue(params) {
      const issues = await Promise.all(params.map(p => createModerationIssue(driver, p)));
      return { issues };
    },
    async appendBotReport(params) {
      const result = await appendModerationActions(driver, params);
      // Existing append result remains deferred: the bot API promises a numeric
      // issueNumber, but the owned row leaves stored values unknown. No new
      // validation/error or race policy is introduced by the read-contract work.
      return { issues: result.issues as unknown as Issue[] };
    },
  };
}
