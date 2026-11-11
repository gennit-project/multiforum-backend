import type { Image, DownloadableFile, QueryResolvers, MutationResolvers } from '../../src/generated/graphql.js';
import type { Selection } from './selection.js';
import type { FixedRawSelectedSource, RawSelectedResolver } from './rawSelectedSource.js';
import type { GraphQLContext } from '../../types/context.js';
export const removedImageColumns = {
  id:true,url:true,storageBucket:true,storageObjectName:true,storageUrl:true,
  permanentlyRemoved:true,permanentlyRemovedAt:true,permanentlyRemovedByUsername:true,permanentlyRemovedByModName:true,
} as const satisfies Selection<Image>;
export const removedFileColumns = {
  ...removedImageColumns,fileName:true,createdAt:true,priceModel:true,priceCents:true,priceCurrency:true,
  paywallExpiresAt:true,stripeProductId:true,stripePriceId:true,downloadCountTotal:true,downloadCountUnique:true,
  attributionOverride:true,supportPatreonUrl:true,supportBuyMeACoffeeUrl:true,supportKoFiUrl:true,supportPayPalMeUrl:true,
  scanStatus:true,scanCheckedAt:true,scanReason:true,reviewRequestedAt:true,reviewRequestReason:true,reviewRequestedByUsername:true,
  uploadedAt:true,uploadedByUsername:true,uploadedByIp:true,kind:true,size:true,
} as const satisfies Selection<DownloadableFile>;
type RemovedAssignments = {
  id:string;permanentlyRemoved:true;permanentlyRemovedAt:string;
  permanentlyRemovedByUsername:string;permanentlyRemovedByModName:string|null;
};
export type RemovedImageColumns = FixedRawSelectedSource<Image,typeof removedImageColumns> & RemovedAssignments;
export type RemovedFileColumns = FixedRawSelectedSource<DownloadableFile,typeof removedFileColumns> & RemovedAssignments;
/** The shared factory can return either explicit query projection. This union
 * does not pretend that the image query selects file-only fields. */
export type RemovedUploadColumns = RemovedImageColumns | RemovedFileColumns;
export const uploadedDiscussionSelection = {id:true,title:true,createdAt:true,updatedAt:true,channelUniqueNames:true} as const;
export type UploadedItemSource = RawSelectedResolver<QueryResolvers<GraphQLContext>['getUploadedDownloadableFiles'],{
  discussion:typeof uploadedDiscussionSelection;
  files:{uploadedByUsername:true;createdAt:true;uploadedAt:true;permanentlyRemovedAt:true};
}>;

/** Both concrete public mutations emit these common columns. File-only columns
 * retain their explicit source type and executed-query guard above. */
export type StoredUploadMutationSources = {
  permanentlyDeleteImage: RawSelectedResolver<MutationResolvers<GraphQLContext>['permanentlyDeleteImage'],typeof removedImageColumns>;
  permanentlyDeleteDownloadableFile: RawSelectedResolver<MutationResolvers<GraphQLContext>['permanentlyDeleteDownloadableFile'],typeof removedImageColumns>;
};
