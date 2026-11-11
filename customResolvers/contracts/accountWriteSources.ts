import type { StoredUploadMutationSources } from './storedUploadSources.js';
import type { MutationResolvers, QueryResolvers } from "../../src/generated/graphql.js";
import type { GraphQLContext } from "../../types/context.js";
import type { SelectedResolver } from "./selection.js";
import { removedDownloadSelection } from "./downloadWrites.js";
export const scratchpadSourceSelection = {id:true,createdAt:true,text:true,isPublic:true,sourceType:true,sourceId:true,Author:{username:true},Recipient:{username:true}} as const;
export const flairSourceSelection = {channelUniqueName:true,flairs:{channelUniqueName:true}} as const;
export const accountWriteSourceMutationNames = ["permanentlyRemoveImage","permanentlyDeleteImage","permanentlyDeleteProfileImage","permanentlyDeleteChannelIcon","permanentlyDeleteChannelBanner","createScratchpadEntry","setChannelDiscussionFlairConfig"] as const;
export const accountWriteSourceQueryNames = ["getChannelDiscussionFlairConfig"] as const;
export type AccountWriteSourceMutationResolvers = {
 permanentlyRemoveImage: SelectedResolver<MutationResolvers<GraphQLContext>["permanentlyRemoveImage"],{id:true;isOpen:true}>;
 permanentlyDeleteImage: SelectedResolver<MutationResolvers<GraphQLContext>["permanentlyDeleteImage"],typeof removedDownloadSelection> & StoredUploadMutationSources["permanentlyDeleteImage"];
 permanentlyDeleteProfileImage: SelectedResolver<MutationResolvers<GraphQLContext>["permanentlyDeleteProfileImage"],{username:true;profilePicURL:true}>;
 permanentlyDeleteChannelIcon: SelectedResolver<MutationResolvers<GraphQLContext>["permanentlyDeleteChannelIcon"],{uniqueName:true;channelIconURL:true}>;
 permanentlyDeleteChannelBanner: SelectedResolver<MutationResolvers<GraphQLContext>["permanentlyDeleteChannelBanner"],{uniqueName:true;channelBannerURL:true}>;
 createScratchpadEntry: SelectedResolver<MutationResolvers<GraphQLContext>["createScratchpadEntry"],typeof scratchpadSourceSelection>;
 setChannelDiscussionFlairConfig: SelectedResolver<MutationResolvers<GraphQLContext>["setChannelDiscussionFlairConfig"],typeof flairSourceSelection>;
};
export type AccountWriteSourceQueryResolvers = {getChannelDiscussionFlairConfig:SelectedResolver<QueryResolvers<GraphQLContext>["getChannelDiscussionFlairConfig"],typeof flairSourceSelection>};
