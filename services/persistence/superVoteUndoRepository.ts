import type { Driver } from 'neo4j-driver';
import { executeGeneratedOperation } from './generatedSchemaOperations.js';
// Exact successful generated-operation selections. Both author branches select
// their discriminator; unrelated model fields remain unavailable.
export type SuperVoteCommentSnapshot = {id:string;SuperUpvotedByUsers:Array<{username:string}>;CommentAuthor:{username:string}|{displayName:string}|null};
export type SuperVoteDiscussionSnapshot = {id:string;SuperUpvotedByUsers:Array<{username:string}>;Discussion:{Author:{username:string}|null}|null};
export interface SuperVoteUndoRepository {
  findComment(id: string): Promise<SuperVoteCommentSnapshot[]>;
  findDiscussion(id: string): Promise<SuperVoteDiscussionSnapshot[]>;
}
export const SUPER_VOTE_COMMENT_SELECTION = `{id SuperUpvotedByUsers {username} CommentAuthor {... on User {username} ... on ModerationProfile {displayName}}}`;
export const SUPER_VOTE_DISCUSSION_SELECTION = `{id SuperUpvotedByUsers {username} Discussion {Author {username}}}`;
const COMMENT = `query SuperVoteUndoComment($where: CommentWhere) {comments(where: $where) ${SUPER_VOTE_COMMENT_SELECTION}}`;
const DISCUSSION = `query SuperVoteUndoDiscussion($where: DiscussionChannelWhere) {discussionChannels(where: $where) ${SUPER_VOTE_DISCUSSION_SELECTION}}`;
export function createSuperVoteUndoRepository(driver: Driver): SuperVoteUndoRepository {
  return {
    async findComment(id) {return (await executeGeneratedOperation<{comments: SuperVoteCommentSnapshot[]}>(driver, COMMENT, {where:{id:{eq:id}}})).comments;},
    async findDiscussion(id) {return (await executeGeneratedOperation<{discussionChannels: SuperVoteDiscussionSnapshot[]}>(driver, DISCUSSION, {where:{id:{eq:id}}})).discussionChannels;},
  };
}
