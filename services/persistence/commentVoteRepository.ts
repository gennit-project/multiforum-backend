import type { Driver } from "neo4j-driver";
import type { Comment, User } from "../../ogm_types.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import { NOTIFICATION_USER_SELECTION } from "./notificationWriter.js";

export interface CommentVoteRepository {
  findComment(id: string): Promise<Comment[]>;
  findVoter(username: string): Promise<User[]>;
  setAuthorKarma(username: string, commentKarma: number): Promise<void>;
}
export const COMMENT_VOTE_SELECTION = `{
  id
  CommentAuthor {
    ... on User { username commentKarma createdAt }
    ... on ModerationProfile { displayName createdAt }
  }
  weightedVotesCount
  UpvotedByUsers { username }
  UpvotedByUsersConnection { aggregate { count { nodes } } }
}`;
const COMMENT = `query CommentVoteSnapshot($where: CommentWhere) {
  comments(where: $where) ${COMMENT_VOTE_SELECTION}
}`;
const VOTER = `query CommentVoteVoter($where: UserWhere) {
  users(where: $where) { username commentKarma }
}`;
const KARMA = `mutation SetCommentVoteAuthorKarma($where: UserWhere, $update: UserUpdateInput) {
  updateUsers(where: $where, update: $update) { users ${NOTIFICATION_USER_SELECTION} }
}`;

// These operations intentionally own sessions separately from the resolver's
// open vote transaction, just as the old model calls did. Keep the full default
// User write projection: a serialization failure can follow a committed update.
export function createCommentVoteRepository(driver: Driver): CommentVoteRepository {
  return {
    async findComment(id) {
      return (await executeGeneratedOperation<{comments: Comment[]}>(driver, COMMENT, {where: {id: {eq: id}}})).comments;
    },
    async findVoter(username) {
      return (await executeGeneratedOperation<{users: User[]}>(driver, VOTER, {where: {username: {eq: username}}})).users;
    },
    async setAuthorKarma(username, commentKarma) {
      await executeGeneratedOperation(driver, KARMA, {where: {username: {eq: username}}, update: {commentKarma: {set: commentKarma}}});
    },
  };
}
