import type { MutationResolvers, PrepareDownloadResult, DiscussionChannel } from "../../src/generated/graphql.js";
import type { GraphQLContext } from "../../types/context.js";
import type { Selection, Projection, SelectedResolver } from "./selection.js";

export const prepareDownloadSelection = {
  ready:true,url:true,scanStatus:true,scanReason:true,scanCheckedAt:true,reviewAccess:true,message:true,
} as const satisfies Selection<PrepareDownloadResult>;
export type PreparedDownload = Projection<PrepareDownloadResult, typeof prepareDownloadSelection>;
export const downloadLabelsSelection = {
  id:true,LabelOptions:{id:true,value:true,displayName:true,order:true,group:{id:true,key:true,displayName:true}},
} as const satisfies Selection<DiscussionChannel>;
export const downloadActionMutationNames = ["prepareDownload","updateDownloadLabels"] as const;
export type DownloadActionMutationResolvers = {
  prepareDownload: SelectedResolver<MutationResolvers<GraphQLContext>["prepareDownload"],typeof prepareDownloadSelection>;
  updateDownloadLabels: SelectedResolver<MutationResolvers<GraphQLContext>["updateDownloadLabels"],typeof downloadLabelsSelection>;
};
