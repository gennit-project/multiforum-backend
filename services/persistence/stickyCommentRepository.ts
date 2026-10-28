import type { Driver } from "neo4j-driver";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
export type StickyCommentState = {
  id?: string | null;
  isRootComment?: boolean | null;
  isFeedbackComment?: boolean | null;
  deleted?: boolean | null;
  archived?: boolean | null;
  isSticky?: boolean | null;
};
export type StickyCommentUpdate = { isSticky?: boolean; stickyAt?: string | null; stickyByUsername?: string | null };
export type StickyCommentResult = {id: string; isSticky?: boolean | null; stickyAt?: string | null; stickyByUsername?: string | null};
export interface StickyCommentRepository {
  findState(id: string): Promise<StickyCommentState[]>;
  updateMetadata(id: string, update: StickyCommentUpdate): Promise<StickyCommentResult[]>;
}
const STICKY_STATE = `query StickyCommentState($where: CommentWhere) {
  comments(where: $where) { id isRootComment isFeedbackComment deleted archived isSticky }
}`;
const STICKY_UPDATE = `mutation UpdateStickyCommentMetadata($where: CommentWhere, $update: CommentUpdateInput) {
  updateComments(where: $where, update: $update) { comments { id isSticky stickyAt stickyByUsername } }
}`;
export function createStickyCommentRepository(driver: Driver): StickyCommentRepository {
  return {
    async findState(id) {
      const result=await executeGeneratedOperation<{comments:StickyCommentState[]}>(driver, STICKY_STATE, {where:{id:{eq:id}}});
      return result.comments;
    },
    async updateMetadata(id, update) {
      const result=await executeGeneratedOperation<{updateComments:{comments:StickyCommentResult[]}}>(driver, STICKY_UPDATE, {where:{id:{eq:id}},update:Object.fromEntries(Object.entries(update).map(([field,value])=>[field,{set:value}]))});
      return result.updateComments.comments;
    },
  };
}
