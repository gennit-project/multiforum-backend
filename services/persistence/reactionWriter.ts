import type { Driver } from "neo4j-driver";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";

export interface ReactionWriter {
  updateCommentEmoji(id: string, emoji: string): Promise<void>;
  updateDiscussionChannelEmoji(id: string, emoji: string): Promise<void>;
}
// Keep the entire former default projection: even unused fields can fail after
// the mutation commits, and native timestamps/events remain schema-owned.
export const REACTION_COMMENT_SELECTION = `{ id text editReason isRootComment isFeedbackComment deleted archived isSticky stickyByUsername weightedVotesCount botMentions isFavoritedByUser emoji stickyAt updatedAt textLastEdited createdAt }`;
export const REACTION_DISCUSSION_CHANNEL_SELECTION = `{ id locked discussionId channelUniqueName weightedVotesCount botMentions archived answered emoji createdAt }`;
const COMMENT_REACTION = `mutation UpdateCommentReaction($where: CommentWhere, $update: CommentUpdateInput) {
  updateComments(where: $where, update: $update) { comments ${REACTION_COMMENT_SELECTION} }
}`;
const DISCUSSION_REACTION = `mutation UpdateDiscussionChannelReaction($where: DiscussionChannelWhere, $update: DiscussionChannelUpdateInput) {
  updateDiscussionChannels(where: $where, update: $update) { discussionChannels ${REACTION_DISCUSSION_CHANNEL_SELECTION} }
}`;
export function createReactionWriter(driver: Driver): ReactionWriter {
  return {
    async updateCommentEmoji(id, emoji) {
      await executeGeneratedOperation(driver, COMMENT_REACTION, {where: {id: {eq: id}}, update: {emoji: {set: emoji}}});
    },
    async updateDiscussionChannelEmoji(id, emoji) {
      await executeGeneratedOperation(driver, DISCUSSION_REACTION, {where: {id: {eq: id}}, update: {emoji: {set: emoji}}});
    },
  };
}
