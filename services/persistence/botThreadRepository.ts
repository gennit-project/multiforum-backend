import type { Driver } from 'neo4j-driver';
export type BotCommentAuthorSnapshot = {
  username?: string | null
  displayName?: string | null
  User?: {
    username?: string | null
  } | null
} | null | undefined

export type BotCommentSnapshot = {
  id?: string | null
  text?: string | null
  ParentComment?: {
    id?: string | null
  } | null
  CommentAuthor?: BotCommentAuthorSnapshot
}

import { executeGeneratedOperation } from './generatedSchemaOperations.js';
export interface BotThreadRepository { findParent(id: string): Promise<BotCommentSnapshot[]>; }
export const BOT_PARENT_SELECTION = `{id text ParentComment {id} CommentAuthor {... on User {username displayName} ... on ModerationProfile {displayName User {username}}}}`;
const PARENT = `query BotParentComment($where: CommentWhere) {comments(where: $where) ${BOT_PARENT_SELECTION}}`;
export const createBotThreadRepository = (driver: Driver): BotThreadRepository => ({
  async findParent(id) {return (await executeGeneratedOperation<{comments:BotCommentSnapshot[]}>(driver,PARENT,{where:{id:{eq:id}}})).comments;},
});
