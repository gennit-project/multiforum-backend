import type { Driver } from "neo4j-driver";
import type { DiscussionChannel, User } from "../../ogm_types.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import { NOTIFICATION_USER_SELECTION } from "./notificationWriter.js";

export interface DiscussionChannelVoteRepository {
  findDiscussionChannel(id: string): Promise<DiscussionChannel[]>;
  findVoter(username: string): Promise<User[]>;
  setAuthorKarma(username: string, discussionKarma: number): Promise<void>;
}
export const DISCUSSION_CHANNEL_VOTE_SELECTION = `{
  id
  Discussion { Author { username discussionKarma createdAt } }
  weightedVotesCount
  UpvotedByUsers { username }
  UpvotedByUsersAggregate { count }
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
      return (await executeGeneratedOperation<{discussionChannels: DiscussionChannel[]}>(driver, DISCUSSION_CHANNEL, {where: {id}})).discussionChannels;
    },
    async findVoter(username) {
      return (await executeGeneratedOperation<{users: User[]}>(driver, VOTER, {where: {username}})).users;
    },
    async setAuthorKarma(username, discussionKarma) {
      await executeGeneratedOperation(driver, KARMA, {where: {username}, update: {discussionKarma}});
    },
  };
}
