import type { MutationResolvers, UndoSuperUpvoteResult } from "../../src/generated/graphql.js";
import type { GraphQLContext } from "../../types/context.js";
import type { Selection, SelectedResolver } from "./selection.js";
export const undoSuperVoteSelection = {success:true,message:true,sourceId:true,sourceType:true} as const satisfies Selection<UndoSuperUpvoteResult>;
export const moderationUndoMutationNames = ["undoSuperUpvote"] as const;
export type ModerationUndoMutationResolvers = {
 undoSuperUpvote: SelectedResolver<MutationResolvers<GraphQLContext>["undoSuperUpvote"],typeof undoSuperVoteSelection>;
};
