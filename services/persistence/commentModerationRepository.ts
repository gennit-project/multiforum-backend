import type {ArchiveIssueSnapshot, ArchiveCommentSnapshot, UnarchiveCommentSnapshot, ArchiveCommentUpdate} from "./archiveProjections.js";
import {archiveIssueAppender, type ArchiveIssueAppender} from "./archiveIssueWrites.js";
import type {ReportModerationIssueRow} from "./moderationIssueWrites.js";
import type { Driver } from "neo4j-driver";
import type { CommentWhere, CommentUpdateInput } from "../../ogm_types.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import { COMMENT_REVISION_DEFAULT_SELECTION } from "./commentRevisionRepository.js";
import {
  createModerationIssue,
  type CreateModerationIssueParams,
} from "./moderationIssueWrites.js";

export interface CommentModerationRepository {
  findArchiveTarget(id: string): Promise<ArchiveCommentSnapshot[]>;
  findUnarchiveTarget(id: string): Promise<UnarchiveCommentSnapshot[]>;
  findIssue(channelUniqueName: string, relatedCommentId: string): Promise<ArchiveIssueSnapshot[]>;
  // FAMILY-3 / v7 (campaign #284): Issue + ModerationAction + Comment writes are
  // owned Cypher (moderationIssueWrites). setArchived stays on the generated API
  // (the archived scalar + the to-many RelatedIssues connect are unchanged in v7).
  createArchiveIssue(params: CreateModerationIssueParams): Promise<{issues: ReportModerationIssueRow[]}>;
  appendIssueAction: ArchiveIssueAppender;
  setArchived(where: CommentWhere, update: CommentUpdateInput): Promise<{comments: ArchiveCommentUpdate[]}>;
}
export const ARCHIVE_TARGET_SELECTION = `{
            id
            text
            CommentAuthor {
              __typename
              ... on User {
                username
              }
              ... on ModerationProfile {
                displayName
                User {
                  username
                }
              }
            }
            Channel {
              uniqueName
            }
            DiscussionChannel {
              discussionId
              channelUniqueName
            }
            Event {
              id
              EventChannels {
                channelUniqueName
              }
            }
            ParentComment {
              Channel {
                uniqueName
              }
              DiscussionChannel {
                discussionId
                channelUniqueName
              }
              Event {
                id
                EventChannels {
                  channelUniqueName
                }
              }
            }
        }`;
const ARCHIVE_TARGET = `query ArchiveCommentTarget($where: CommentWhere!) { comments(where: $where) ${ARCHIVE_TARGET_SELECTION} }`;
export const UNARCHIVE_TARGET_SELECTION = `{
              id
              text
              Channel {
                uniqueName
              }
              DiscussionChannel {
                channelUniqueName
              }
              Event {
                EventChannels {
                  channelUniqueName
                }
              }
              ParentComment {
                Channel {
                  uniqueName
                }
                DiscussionChannel {
                  channelUniqueName
                }
                Event {
                  EventChannels {
                    channelUniqueName
                  }
                }
              }
          }`;
const UNARCHIVE_TARGET = `query UnarchiveCommentTarget($where: CommentWhere!) { comments(where: $where) ${UNARCHIVE_TARGET_SELECTION} }`;

const ISSUE_SELECTION = `{ id issueNumber flaggedServerRuleViolation }`;
const FIND_ISSUE = `query CommentModerationIssue($where: IssueWhere!) { issues(where: $where) ${ISSUE_SELECTION} }`;
const UPDATE_COMMENT = `mutation SetCommentArchived($where: CommentWhere!, $update: CommentUpdateInput!) { updateComments(where: $where, update: $update) { comments ${COMMENT_REVISION_DEFAULT_SELECTION} } }`;
export function createCommentModerationRepository(driver: Driver): CommentModerationRepository {
  return {
    async findArchiveTarget(id) {
      return (await executeGeneratedOperation<{comments: ArchiveCommentSnapshot[]}>(driver, ARCHIVE_TARGET, {where: {id: {eq: id}}})).comments;
    },
    async findUnarchiveTarget(id) {
      return (await executeGeneratedOperation<{comments: UnarchiveCommentSnapshot[]}>(driver, UNARCHIVE_TARGET, {where: {id: {eq: id}}})).comments;
    },
    async findIssue(channelUniqueName, relatedCommentId) {
      return (await executeGeneratedOperation<{issues: ArchiveIssueSnapshot[]}>(driver, FIND_ISSUE, {where: {channelUniqueName: {eq: channelUniqueName}, relatedCommentId: {eq: relatedCommentId}}})).issues;
    },
    async createArchiveIssue(params) {
      const issue = await createModerationIssue(driver, params);
      return { issues: [issue] };
    },
    appendIssueAction: archiveIssueAppender(driver),
    async setArchived(where, update) {
      return (await executeGeneratedOperation<{updateComments: {comments: ArchiveCommentUpdate[]}}>(driver, UPDATE_COMMENT, {where, update})).updateComments;
    },
  };
}
