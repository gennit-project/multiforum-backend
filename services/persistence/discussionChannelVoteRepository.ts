import type { Projection } from "../../customResolvers/contracts/selection.js";
import type { Driver } from "neo4j-driver";
import type { DiscussionChannel, User } from "../../ogm_types.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import { NOTIFICATION_USER_SELECTION } from "./notificationWriter.js";

export type DiscussionChannelVoteSnapshot = Pick<DiscussionChannel, "id" | "weightedVotesCount"> & {
  Discussion?: { Author?: Pick<User, "username" | "discussionKarma" | "createdAt"> | null } | null;
  UpvotedByUsers: Pick<User, "username">[];
  UpvotedByUsersConnection: Projection<DiscussionChannel["UpvotedByUsersConnection"], { aggregate: { count: { nodes: true } } }>;
};
export type DiscussionVoterSnapshot = Pick<User, "username" | "discussionKarma">;

export interface DiscussionChannelVoteRepository {
  findDiscussionChannel(id: string): Promise<DiscussionChannelVoteSnapshot[]>;
  findVoter(username: string): Promise<DiscussionVoterSnapshot[]>;
  setAuthorKarma(username: string, discussionKarma: number): Promise<void>;
}
export const DISCUSSION_CHANNEL_VOTE_SELECTION = `{
  id
  Discussion { Author { username discussionKarma createdAt } }
  weightedVotesCount
  UpvotedByUsers { username }
  UpvotedByUsersConnection { aggregate { count { nodes } } }
}`;
const DISCUSSION_CHANNEL = `query DiscussionChannelVoteSnapshot($where: DiscussionChannelWhere) {
  discussionChannels(where: $where) ${DISCUSSION_CHANNEL_VOTE_SELECTION}
}`;
const VOTER = `query DiscussionChannelVoteVoter($where: UserWhere) {
  users(where: $where) { username discussionKarma }
}`;
const KARMA = `mutation SetDiscussionChannelVoteAuthorKarma($where: UserWhere, $update: UserUpdateInput) {
  updateUsers(where: $where, update: $update) { users ${NOTIFICATION_USER_SELECTION} }
}`;

// These operations intentionally own sessions separately from the resolver's
// open vote transaction, just as the old model calls did. Keep the full default
// User write projection: a serialization failure can follow a committed update.
export function createDiscussionChannelVoteRepository(driver: Driver): DiscussionChannelVoteRepository {
  return {
    async findDiscussionChannel(id) {
      return (await executeGeneratedOperation<{discussionChannels: DiscussionChannelVoteSnapshot[]}>(driver, DISCUSSION_CHANNEL, {where: {id: {eq: id}}})).discussionChannels;
    },
    async findVoter(username) {
      return (await executeGeneratedOperation<{users: DiscussionVoterSnapshot[]}>(driver, VOTER, {where: {username: {eq: username}}})).users;
    },
    async setAuthorKarma(username, discussionKarma) {
      await executeGeneratedOperation(driver, KARMA, {where: {username: {eq: username}}, update: {discussionKarma: {set: discussionKarma}}});
    },
  };
}
