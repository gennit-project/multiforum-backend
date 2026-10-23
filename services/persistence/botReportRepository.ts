import type { Driver } from "neo4j-driver";
import type { Issue, Comment, Discussion, Event, IssueWhere, IssueCreateInput, IssueUpdateInput } from "../../ogm_types.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
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
export const CREATEREPORTEDISSUE_SELECTION = `{
          issues {
            id
            issueNumber
            flaggedServerRuleViolation
          }
        }`;
export const APPENDBOTREPORT_SELECTION = `{
        issues {
          id
          issueNumber
          flaggedServerRuleViolation
        }
      }`;
export interface BotReportRepository {
  findExistingReport(where: IssueWhere): Promise<Issue[]>;
  findIdempotentReport(where: IssueWhere, idempotencyKey: string): Promise<Issue[]>;
  findReportedComment(id: string): Promise<Comment[]>;
  findReportedDiscussion(id: string): Promise<Discussion[]>;
  findReportedEvent(id: string): Promise<Event[]>;
  createReportedIssue(input: IssueCreateInput[]): Promise<{issues:Issue[]}>;
  appendBotReport(where: IssueWhere, update: IssueUpdateInput): Promise<{issues:Issue[]}>;
}
export function createBotReportRepository(driver: Driver): BotReportRepository {
  return {
    async findExistingReport(where) {
      const result = await executeGeneratedOperation<{issues:Issue[]}>(driver,
        `query BotReport_findExistingReport($where: IssueWhere) { issues(where: $where) ${FINDEXISTINGREPORT_SELECTION} }`, {where});
      return result.issues;
    },
    async findIdempotentReport(where, idempotencyKey) {
      const result = await executeGeneratedOperation<{issues:Issue[]}>(driver,
        `query BotReport_findIdempotentReport($where: IssueWhere) { issues(where: $where) ${FINDEXISTINGREPORT_SELECTION} }`, {
          where: {
            ...where,
            ActivityFeed_SOME: { idempotencyKey },
          },
        });
      return result.issues;
    },
    async findReportedComment(id) {
      const result = await executeGeneratedOperation<{comments:Comment[]}>(driver,
        `query BotReport_findReportedComment($where: CommentWhere) { comments(where: $where) ${FINDREPORTEDCOMMENT_SELECTION} }`, {where:{id}});
      return result.comments;
    },
    async findReportedDiscussion(id) {
      const result = await executeGeneratedOperation<{discussions:Discussion[]}>(driver,
        `query BotReport_findReportedDiscussion($where: DiscussionWhere) { discussions(where: $where) ${FINDREPORTEDDISCUSSION_SELECTION} }`, {where:{id}});
      return result.discussions;
    },
    async findReportedEvent(id) {
      const result = await executeGeneratedOperation<{events:Event[]}>(driver,
        `query BotReport_findReportedEvent($where: EventWhere) { events(where: $where) ${FINDREPORTEDEVENT_SELECTION} }`, {where:{id}});
      return result.events;
    },
    async createReportedIssue(input) {
      const result = await executeGeneratedOperation<{createIssues:{issues:Issue[]}}>(driver,
        `mutation BotReport_createReportedIssue($input: [IssueCreateInput!]!) { createIssues(input: $input) ${CREATEREPORTEDISSUE_SELECTION} }`, {input});
      return result.createIssues;
    },
    async appendBotReport(where, update) {
      const result = await executeGeneratedOperation<{updateIssues:{issues:Issue[]}}>(driver,
        `mutation BotReport_appendBotReport($where: IssueWhere, $update: IssueUpdateInput) { updateIssues(where: $where, update: $update) ${APPENDBOTREPORT_SELECTION} }`, {where,update});
      return result.updateIssues;
    },
  };
}
