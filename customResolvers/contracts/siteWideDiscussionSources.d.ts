import type { Integer } from 'neo4j-driver';
import type { DiscussionListAuthor,DiscussionListAlbum,DiscussionListFlair } from './viewerReadProjections.js';
import type { SiteWideDownloadFile } from './siteWideDownloadFiles.js';
/** Exact owned hydration document, not completed GraphQL entities. */
export type SiteWideDiscussionChannelSource={
 id:unknown; createdAt:unknown; channelUniqueName:unknown; discussionId:unknown;
 weightedVotesCount:unknown; archived:unknown; answered:unknown; locked:unknown;
 Flairs:DiscussionListFlair[];
 Channel:{uniqueName:unknown;displayName:unknown;channelIconURL:unknown};
 UpvotedByUsers:{username:unknown}[]; SuperUpvotedByUsers:{username:unknown}[];
 CommentsConnection:{totalCount:Integer;aggregate:{count:{nodes:Integer}}};
};
export type SiteWideDiscussionSource={
 id:unknown;title:unknown;body:unknown;createdAt:unknown;updatedAt:unknown;
 hasSensitiveContent:unknown;hasSpoiler:unknown;Author:DiscussionListAuthor|null;
 DiscussionChannels:SiteWideDiscussionChannelSource[];Tags:{text:unknown}[];
 Album:DiscussionListAlbum|null;DownloadableFiles:SiteWideDownloadFile[];
 isFavorited:boolean|null;
};
