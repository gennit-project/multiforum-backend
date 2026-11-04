import { createdDiscussionSelection, createdEventSelection, createdEventSeriesSelection, updatedEventSelection, updatedSeriesOccurrenceSelection, updatedDiscussionSelection } from "./contentProjections.js";
import type { MutationResolvers, TextVersion, WikiPage, Issue, Comment, DeleteEventInSeriesResult } from "../../src/generated/graphql.js";
import type { GraphQLContext } from "../../types/context.js";
import type { Selection, SelectedResolver, Projection } from "./selection.js";

export const revisionSelection = { id: true, body: true, editReason: true, createdAt: true, updatedAt: true, Author: { username: true } } as const satisfies Selection<TextVersion>;
export type RevisionProjection = Projection<TextVersion, typeof revisionSelection>;
export const writtenWikiSelection = {
 id: true, title: true, body: true, slug: true, channelUniqueName: true,
 editReason: true, createdAt: true, updatedAt: true, locked: true,
 OriginalAuthor: { username: true }, VersionAuthor: { username: true }, Channel: { uniqueName: true },
 ChildPages: { id: true, title: true, slug: true },
 PastVersions: { id: true, body: true, editReason: true, createdAt: true, Author: { username: true } },
} as const satisfies Selection<WikiPage>;
export type WrittenWikiProjection = Projection<WikiPage, typeof writtenWikiSelection>;
export const submittedIssueSelection = {
 id: true, issueNumber: true, title: true, body: true, isOpen: true, channelUniqueName: true,
 authorName: true, createdAt: true, updatedAt: true, relatedCommentId: true, relatedDiscussionId: true,
 relatedEventId: true, relatedWikiPageId: true, relatedWikiRevisionId: true, relatedImageId: true,
 relatedAlbumId: true, relatedUsername: true, relatedModProfileName: true, relatedChannelUniqueName: true,
 flaggedServerRuleViolation: true, Channel: { uniqueName: true },
} as const satisfies Selection<Issue>;
// Author is a union: its operation projection preserves the two alternatives.
export type SubmittedIssueProjection = Projection<Issue, typeof submittedIssueSelection> & {
 Author: { username: string } | { displayName: string } | null;
};
export const ownedCommentSelection = { id: true, text: true, isRootComment: true, isFeedbackComment: true, deleted: true, archived: true, weightedVotesCount: true, botMentions: true, createdAt: true } as const satisfies Selection<Comment>;
export type OwnedCommentProjection = Projection<Comment, typeof ownedCommentSelection>;
export const deleteEventSelection = { success: true, deletedCount: true, message: true } as const satisfies Selection<DeleteEventInSeriesResult>;
export const contentMutationNames = [
 "createDiscussionWithChannelConnections", "createEventWithChannelConnections",
 "updateDiscussionWithChannelConnections", "updateEventWithChannelConnections", "updateEventInSeries",
 "createEventSeriesWithChannelConnections",
 "addImageToAlbum", "removeImageFromAlbum", "setWikiHomePage", "writeWikiPage", "createIssue",
 "createCommentWithOwnedConnections", "deleteEventInSeries", "deleteCommentRevision",
 "deleteDiscussionBodyRevision", "deleteEventDescriptionRevision", "deleteWikiRevision",
] as const;
export type ContentMutationResolvers = {
 createDiscussionWithChannelConnections: SelectedResolver<MutationResolvers<GraphQLContext>["createDiscussionWithChannelConnections"], typeof createdDiscussionSelection>;
 createEventWithChannelConnections: SelectedResolver<MutationResolvers<GraphQLContext>["createEventWithChannelConnections"], typeof createdEventSelection>;
 updateDiscussionWithChannelConnections: SelectedResolver<MutationResolvers<GraphQLContext>["updateDiscussionWithChannelConnections"], typeof updatedDiscussionSelection>;
 updateEventWithChannelConnections: SelectedResolver<MutationResolvers<GraphQLContext>["updateEventWithChannelConnections"], typeof updatedEventSelection>;
 updateEventInSeries: SelectedResolver<MutationResolvers<GraphQLContext>["updateEventInSeries"], typeof updatedSeriesOccurrenceSelection>;
 createEventSeriesWithChannelConnections: SelectedResolver<MutationResolvers<GraphQLContext>["createEventSeriesWithChannelConnections"], typeof createdEventSeriesSelection>;
 addImageToAlbum: NonNullable<MutationResolvers<GraphQLContext>["addImageToAlbum"]>;
 removeImageFromAlbum: NonNullable<MutationResolvers<GraphQLContext>["removeImageFromAlbum"]>;
 setWikiHomePage: NonNullable<MutationResolvers<GraphQLContext>["setWikiHomePage"]>;
 writeWikiPage: SelectedResolver<MutationResolvers<GraphQLContext>["writeWikiPage"], typeof writtenWikiSelection>;
 createIssue: SelectedResolver<MutationResolvers<GraphQLContext>["createIssue"], typeof submittedIssueSelection>;
 createCommentWithOwnedConnections: SelectedResolver<MutationResolvers<GraphQLContext>["createCommentWithOwnedConnections"], { comments: typeof ownedCommentSelection }>;
 deleteEventInSeries: SelectedResolver<MutationResolvers<GraphQLContext>["deleteEventInSeries"], typeof deleteEventSelection>;
 deleteCommentRevision: SelectedResolver<MutationResolvers<GraphQLContext>["deleteCommentRevision"], typeof revisionSelection>;
 deleteDiscussionBodyRevision: SelectedResolver<MutationResolvers<GraphQLContext>["deleteDiscussionBodyRevision"], typeof revisionSelection>;
 deleteEventDescriptionRevision: SelectedResolver<MutationResolvers<GraphQLContext>["deleteEventDescriptionRevision"], typeof revisionSelection>;
 deleteWikiRevision: SelectedResolver<MutationResolvers<GraphQLContext>["deleteWikiRevision"], typeof revisionSelection>;
};
