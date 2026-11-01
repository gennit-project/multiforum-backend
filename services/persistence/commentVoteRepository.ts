import type { Projection } from "../../customResolvers/contracts/selection.js";
import type { Driver } from "neo4j-driver";
import type { Comment, User, ModerationProfile } from "../../ogm_types.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import { NOTIFICATION_USER_SELECTION } from "./notificationWriter.js";

export type CommentVoteSnapshot = Pick<Comment, "id" | "weightedVotesCount"> & {
  CommentAuthor?: Pick<User, "username" | "commentKarma" | "createdAt"> |
    Pick<ModerationProfile, "displayName" | "createdAt"> | null;
  UpvotedByUsers: Pick<User, "username">[];
  UpvotedByUsersConnection: Projection<Comment["UpvotedByUsersConnection"], { aggregate: { count: { nodes: true } } }>;
};
export type CommentVoterSnapshot = Pick<User, "username" | "commentKarma">;

export interface CommentVoteRepository {
  findComment(id: string): Promise<CommentVoteSnapshot[]>;
  findVoter(username: string): Promise<CommentVoterSnapshot[]>;
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
      return (await executeGeneratedOperation<{comments: CommentVoteSnapshot[]}>(driver, COMMENT, {where: {id: {eq: id}}})).comments;
    },
    async findVoter(username) {
      return (await executeGeneratedOperation<{users: CommentVoterSnapshot[]}>(driver, VOTER, {where: {username: {eq: username}}})).users;
    },
    async setAuthorKarma(username, commentKarma) {
      await executeGeneratedOperation(driver, KARMA, {where: {username: {eq: username}}, update: {commentKarma: {set: commentKarma}}});
    },
  };
}
