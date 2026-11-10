import type {CustomViewerComment,CustomRootComment,CustomReplyComment,CustomEventComment,CustomCommentSectionChannel} from "./customCommentSources.js";
import type { DiscussionListFlair } from "./discussionListFlairs.js";
export type { DiscussionListFlair } from "./discussionListFlairs.js";
import type { Integer } from "neo4j-driver";
/** Fixed Cypher expression provenance, not full persisted entity contracts.
 * Unknown persisted leaves preserve GraphQL's lazy scalar completion. */
export type ViewerIdentity = { username: string };
export type ViewerComment = CustomViewerComment;
export type ReplyViewerComment = CustomReplyComment;
export type RootViewerComment = CustomRootComment;
export type EventViewerComment = CustomEventComment;
export type CommentRepliesRow = { ChildComments: ReplyViewerComment[]; aggregateChildCommentCount: Integer };
export type CommentSectionChannel = CustomCommentSectionChannel;
export type {EventMetadataSource as EventViewerMetadata} from './eventMetadataSource.js';
export type {DetailCore as DiscussionViewerCore,DetailChannel as DiscussionViewerChannel,DetailSource as DiscussionViewerDetail} from './discussionDetailSources.js';
/** Exact maps emitted by getDiscussionChannelsQuery.cypher. Persisted leaves
 * deliberately remain unknown; only query-computed values are narrowed. */
export type DiscussionListAuthor = {
  username: unknown; displayName: unknown; profilePicURL: unknown;
  createdAt: unknown; discussionKarma: unknown; commentKarma: unknown;
};
export type DiscussionListImage = {
  id: unknown; url: unknown; alt: unknown; caption: unknown;
  archived: unknown; permanentlyRemoved: unknown;
};
export type DiscussionListAlbum = {id: unknown; imageOrder: unknown; Images: DiscussionListImage[]};
export type DiscussionListDiscussion = {
  id: unknown; title: unknown; body: unknown; createdAt: unknown; updatedAt: unknown;
  hasSensitiveContent: unknown; hasSpoiler: unknown;
  Author: DiscussionListAuthor | null; Album: DiscussionListAlbum | null;
  Tags: {text: unknown}[]; DownloadableFiles: {id: unknown; scanStatus: unknown}[];
  authorIsChannelModerator: boolean;
};
export type DiscussionListViewerChannel = {
  id: unknown; archived: unknown; answered: unknown; locked: unknown;
  discussionId: unknown; createdAt: unknown; channelUniqueName: unknown;
  weightedVotesCount: unknown; Flairs: DiscussionListFlair[];
  CommentsAggregate: {count: Integer}; UpvotedByUsersAggregate: {count: Integer};
  UpvotedByUsers: ViewerIdentity[]; SuperUpvotedByUsers: ViewerIdentity[];
  isFavorited: boolean | null; Discussion: DiscussionListDiscussion;
  Channel: {uniqueName: unknown};
};
export type SortedChannelCount = {totalCount:Integer;aggregate:{count:{nodes:Integer}}};
/** Exact inline sorted-channel query map. Stored leaves remain GraphQL-owned. */
export type SortedViewerChannel = {
 uniqueName:unknown;displayName:unknown;channelIconURL:unknown;description:unknown;
 isFavorited:boolean|null;Tags:{text:unknown}[];
 EventChannelsAggregate:{count:Integer};DiscussionChannelsAggregate:{count:Integer};
 EventChannelsConnection:SortedChannelCount;DiscussionChannelsConnection:SortedChannelCount;
};
