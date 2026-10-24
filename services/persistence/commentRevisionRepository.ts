import type { Driver } from "neo4j-driver";
import type { CommentSnapshot } from "../../utils/buildCommentMentionContext.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import { createTextVersion, splitTextVersionInput } from "./textVersionWrite.js";

export interface CommentRevisionRepository {
  findSnapshot(id: string): Promise<CommentSnapshot[]>;
  findEditor(username: string): Promise<Array<{username: string}>>;
  createPreviousText(input: Record<string, unknown>): Promise<{textVersions: Array<{id: string}>}>;
  findCommentIds(id: string): Promise<Array<{id: string}>>;
  connectPreviousText(id: string, versionId: string, editedAt: string): Promise<void>;
}
const SNAPSHOT = `query CommentRevisionSnapshot($where: CommentWhere!) {
 comments(where: $where) {
          id
          text
          CommentAuthor {
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
          DiscussionChannel {
            discussionId
            channelUniqueName
            Discussion {
              id
              title
            }
          }
          Event {
            id
            title
            EventChannels {
              channelUniqueName
            }
          }
          PastVersions {
            id
            body
            createdAt
          }
        }
}`;
const EDITOR = `query CommentRevisionEditor($where: UserWhere!) { users(where: $where) { username } }`;
const IDS = `query CommentRevisionTarget($where: CommentWhere!) { comments(where: $where) { id } }`;
// Full production OGM default projections preserve post-commit response failures.
export const COMMENT_REVISION_DEFAULT_SELECTION = `{
  id
  text
  editReason
  isRootComment
  isFeedbackComment
  deleted
  archived
  isSticky
  stickyByUsername
  weightedVotesCount
  botMentions
  isFavoritedByUser
  emoji
  stickyAt
  updatedAt
  textLastEdited
  createdAt
}`;
export const TEXT_VERSION_DEFAULT_SELECTION = `{ id body editReason createdAt updatedAt }`;
const CONNECT = `mutation ConnectPreviousCommentText($where: CommentWhere!, $update: CommentUpdateInput!) {
 updateComments(where: $where, update: $update) { comments ${COMMENT_REVISION_DEFAULT_SELECTION} }
}`;
export function createCommentRevisionRepository(driver: Driver): CommentRevisionRepository {
  return {
    async findSnapshot(id) {
      const result = await executeGeneratedOperation<{comments: CommentSnapshot[]}>(driver, SNAPSHOT, {where: {id}});
      return result.comments;
    },
    async findEditor(username) {
      const result = await executeGeneratedOperation<{users: Array<{username: string}>}>(driver, EDITOR, {where: {username}});
      return result.users;
    },
    async createPreviousText(input) {
      const { scalars, authorUsername } = splitTextVersionInput(input);
      return createTextVersion(driver, scalars, authorUsername);
    },
    async findCommentIds(id) {
      const result = await executeGeneratedOperation<{comments: Array<{id: string}>}>(driver, IDS, {where: {id}});
      return result.comments;
    },
    async connectPreviousText(id, versionId, editedAt) {
      await executeGeneratedOperation(driver, CONNECT, {where: {id}, update: {
        textLastEdited: editedAt,
        PastVersions: {connect: [{where: {node: {id: versionId}}}]},
      }});
    },
  };
}
