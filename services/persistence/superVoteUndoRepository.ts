import type { Driver } from 'neo4j-driver';
import type { Comment, DiscussionChannel } from '../../ogm_types.js';
import { executeGeneratedOperation } from './generatedSchemaOperations.js';
export interface SuperVoteUndoRepository {
  findComment(id: string): Promise<Comment[]>;
  findDiscussion(id: string): Promise<DiscussionChannel[]>;
}
export const SUPER_VOTE_COMMENT_SELECTION = `{id SuperUpvotedByUsers {username} CommentAuthor {... on User {username}}}`;
export const SUPER_VOTE_DISCUSSION_SELECTION = `{id SuperUpvotedByUsers {username} Discussion {Author {username}}}`;
const COMMENT = `query SuperVoteUndoComment($where: CommentWhere) {comments(where: $where) ${SUPER_VOTE_COMMENT_SELECTION}}`;
const DISCUSSION = `query SuperVoteUndoDiscussion($where: DiscussionChannelWhere) {discussionChannels(where: $where) ${SUPER_VOTE_DISCUSSION_SELECTION}}`;
export function createSuperVoteUndoRepository(driver: Driver): SuperVoteUndoRepository {
  return {
    async findComment(id) {return (await executeGeneratedOperation<{comments: Comment[]}>(driver, COMMENT, {where:{id}})).comments;},
    async findDiscussion(id) {return (await executeGeneratedOperation<{discussionChannels: DiscussionChannel[]}>(driver, DISCUSSION, {where:{id}})).discussionChannels;},
  };
}
