import type {RawSelectedResolver} from './rawSelectedSource.js';
import type { MutationResolvers, UndoSuperUpvoteResult } from "../../src/generated/graphql.js";
import type { GraphQLContext } from "../../types/context.js";
import type { Selection, SelectedResolver } from "./selection.js";
export const undoSuperVoteSelection = {success:true,message:true,sourceId:true,sourceType:true} as const satisfies Selection<UndoSuperUpvoteResult>;
export const undoSuperVoteSourceSelection = {...undoSuperVoteSelection,superUpvotedByUsers:{username:true}} as const satisfies Selection<UndoSuperUpvoteResult>;
export type UndoSuperVoteSource=RawSelectedResolver<MutationResolvers<GraphQLContext>['undoSuperUpvote'],typeof undoSuperVoteSourceSelection>;
export const moderationUndoMutationNames = ["undoSuperUpvote"] as const;
export type ModerationUndoMutationResolvers = {
 undoSuperUpvote: SelectedResolver<MutationResolvers<GraphQLContext>["undoSuperUpvote"],typeof undoSuperVoteSelection> & UndoSuperVoteSource;
};
