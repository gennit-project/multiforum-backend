import type { Integer } from "neo4j-driver";
/** Fixed Cypher expression provenance, not full persisted entity contracts.
 * Unknown keys intentionally preserve GraphQL's lazy scalar completion. */
type Persisted = Record<string, unknown>;
export type ViewerIdentity = { username: string };
export type ViewerComment = Persisted & {
  isFavoritedByUser: boolean;
  SubscribedToNotifications: ViewerIdentity[];
};
export type ReplyViewerComment = ViewerComment & { ParentComment: { id: string } };
export type RootViewerComment = ViewerComment & { ParentComment: null };
export type CommentRepliesRow = { ChildComments: ReplyViewerComment[]; aggregateChildCommentCount: Integer };
export type CommentSectionChannel = Persisted & {
  discussionId: string; channelUniqueName: string;
  SubscribedToNotifications: ViewerIdentity[];
  Channel: Persisted & { uniqueName: string };
  Discussion: Persisted & { id: string };
};
export type EventViewerMetadata = Persisted & {
  id: string;
  SubscribedToNotifications: ViewerIdentity[];
  SubscribedToEventUpdates: ViewerIdentity[];
};
export type DiscussionViewerCore = Persisted & { id: string; isFavorited: boolean | null };
export type DiscussionViewerChannel = Persisted & {
  discussionId: string; channelUniqueName: string;
  UpvotedByUsers: ViewerIdentity[]; SuperUpvotedByUsers: ViewerIdentity[];
};
export type DiscussionViewerDetail = DiscussionViewerCore & {
  DiscussionChannels: DiscussionViewerChannel[]; DownloadableFiles: unknown[];
};
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
export type DiscussionListFlair = {
  id: unknown; channelUniqueName: unknown; displayName: unknown; color: unknown;
  order: unknown; archived: unknown;
};
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
export type SortedViewerChannel = Persisted & { isFavorited: boolean | null };
