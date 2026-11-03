import type { MutationResolvers, WikiPage, Comment, ServerConfig, CreateCommentsWithOwnedConnectionsResponse } from "../../src/generated/graphql.js";
import type { GraphQLContext } from "../../types/context.js";
import type { Selection, SelectedResolver } from "./selection.js";

export const wikiLockSelection = {id:true,title:true,body:true,slug:true,channelUniqueName:true,locked:true,lockedAt:true,lockReason:true,lockedByUsername:true} as const satisfies Selection<WikiPage>;
export const stickySelection = {id:true,isSticky:true,stickyAt:true,stickyByUsername:true} as const satisfies Selection<Comment>;
export const featuredWikiSelection = {serverName:true,featuredWikiPageIds:true} as const satisfies Selection<ServerConfig>;
export const softDeleteSelection = {comments:{id:true,text:true,weightedVotesCount:true,createdAt:true,updatedAt:true}} as const satisfies Selection<CreateCommentsWithOwnedConnectionsResponse>;
export const moderationMutationNames = ["lockWikiPage","unlockWikiPage","pinWikiPageToChannel","unpinWikiPageFromChannel","setFeaturedWikiPages","stickyComment","unstickyComment","softDeleteComment"] as const;
export type ModerationMutationResolvers = {
 lockWikiPage: SelectedResolver<MutationResolvers<GraphQLContext>["lockWikiPage"],typeof wikiLockSelection>;
 unlockWikiPage: SelectedResolver<MutationResolvers<GraphQLContext>["unlockWikiPage"],typeof wikiLockSelection>;
 pinWikiPageToChannel: NonNullable<MutationResolvers<GraphQLContext>["pinWikiPageToChannel"]>;
 unpinWikiPageFromChannel: NonNullable<MutationResolvers<GraphQLContext>["unpinWikiPageFromChannel"]>;
 setFeaturedWikiPages: SelectedResolver<MutationResolvers<GraphQLContext>["setFeaturedWikiPages"],typeof featuredWikiSelection>;
 stickyComment: SelectedResolver<MutationResolvers<GraphQLContext>["stickyComment"],typeof stickySelection>;
 unstickyComment: SelectedResolver<MutationResolvers<GraphQLContext>["unstickyComment"],typeof stickySelection>;
 softDeleteComment: SelectedResolver<MutationResolvers<GraphQLContext>["softDeleteComment"],typeof softDeleteSelection>;
};
