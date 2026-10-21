import type { Driver } from "neo4j-driver";
import type { Comment, Issue, IssueCreateInput, IssueWhere, IssueUpdateInput, CommentWhere, CommentUpdateInput } from "../../ogm_types.js";
import { attachIssueIdentityRelationships, assertIssueIdentityUpdateAllowed } from "../issueTargetIdentity.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import { COMMENT_REVISION_DEFAULT_SELECTION } from "./commentRevisionRepository.js";

export interface CommentModerationRepository {
  findArchiveTarget(id: string): Promise<Comment[]>;
  findUnarchiveTarget(id: string): Promise<Comment[]>;
  findIssue(channelUniqueName: string, relatedCommentId: string): Promise<Issue[]>;
  createArchiveIssue(input: IssueCreateInput): Promise<{issues: Issue[]}>;
  appendIssueAction(where: IssueWhere, update: IssueUpdateInput): Promise<{issues: Issue[]}>;
  setArchived(where: CommentWhere, update: CommentUpdateInput): Promise<{comments: Comment[]}>;
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
const CREATE_ISSUE = `mutation CreateCommentArchiveIssue($input: [IssueCreateInput!]!) { createIssues(input: $input) { issues ${ISSUE_SELECTION} } }`;
const UPDATE_ISSUE = `mutation AppendCommentModerationAction($where: IssueWhere!, $update: IssueUpdateInput!) { updateIssues(where: $where, update: $update) { issues ${ISSUE_SELECTION} } }`;
const UPDATE_COMMENT = `mutation SetCommentArchived($where: CommentWhere!, $update: CommentUpdateInput!) { updateComments(where: $where, update: $update) { comments ${COMMENT_REVISION_DEFAULT_SELECTION} } }`;
export function createCommentModerationRepository(driver: Driver): CommentModerationRepository {
  return {
    async findArchiveTarget(id) {
      return (await executeGeneratedOperation<{comments: Comment[]}>(driver, ARCHIVE_TARGET, {where: {id}})).comments;
    },
    async findUnarchiveTarget(id) {
      return (await executeGeneratedOperation<{comments: Comment[]}>(driver, UNARCHIVE_TARGET, {where: {id}})).comments;
    },
    async findIssue(channelUniqueName, relatedCommentId) {
      return (await executeGeneratedOperation<{issues: Issue[]}>(driver, FIND_ISSUE, {where: {channelUniqueName, relatedCommentId}})).issues;
    },
    async createArchiveIssue(input) {
      const attached = attachIssueIdentityRelationships(input);
      return (await executeGeneratedOperation<{createIssues: {issues: Issue[]}}>(driver, CREATE_ISSUE, {input: [attached]})).createIssues;
    },
    async appendIssueAction(where, update) {
      assertIssueIdentityUpdateAllowed(update);
      return (await executeGeneratedOperation<{updateIssues: {issues: Issue[]}}>(driver, UPDATE_ISSUE, {where, update})).updateIssues;
    },
    async setArchived(where, update) {
      return (await executeGeneratedOperation<{updateComments: {comments: Comment[]}}>(driver, UPDATE_COMMENT, {where, update})).updateComments;
    },
  };
}
