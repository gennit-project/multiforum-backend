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
export type DiscussionListViewerChannel = Persisted & {
  UpvotedByUsers: ViewerIdentity[]; SuperUpvotedByUsers: ViewerIdentity[];
  isFavorited: boolean | null;
  Discussion: Persisted & { authorIsChannelModerator: boolean };
};
export type SortedViewerChannel = Persisted & { isFavorited: boolean | null };
