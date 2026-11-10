import type { DownloadableFile, SiteWideDiscussionListItemResolvers } from '../../src/generated/graphql.js';
import type { GraphQLContext } from '../../types/context.js';
import type { Selection } from './selection.js';
import type { RawSelectedSource, RawSelectedListResolver } from './rawSelectedSource.js';
export const siteWideDownloadFileSelection={id:true,scanStatus:true} as const satisfies Selection<DownloadableFile>;
export type SiteWideDownloadFileFields=RawSelectedSource<DownloadableFile,typeof siteWideDownloadFileSelection>;
export type SiteWideDownloadFile=SiteWideDownloadFileFields & {readonly scanStatus:unknown};
export type SiteWideDownloadFileSource=RawSelectedListResolver<
 SiteWideDiscussionListItemResolvers<GraphQLContext>['DownloadableFiles'],typeof siteWideDownloadFileSelection>;
