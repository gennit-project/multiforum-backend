import type {
  AlbumResolvers, DiscussionResolvers, DiscussionChannelResolvers,
  CommentAuthorResolvers, IssueAuthorResolvers, DownloadableFileResolvers, UserResolvers,
} from "../../src/generated/graphql.js";
import type { SelectedResolver } from "./selection.js";
import { profileCollectionSelection } from "./accountProjections.js";
import type { GraphQLContext } from "../../types/context.js";

// These fields construct their scalar/page-info results or use the already
// decoded URL-access repository. Arbitrary prepopulated list items are excluded.
export type CheckedAlbumFields = Required<Pick<AlbumResolvers<GraphQLContext>, "detailImagesPageInfo">>;
export type CheckedDiscussionFields = Required<Pick<DiscussionResolvers<GraphQLContext>, "detailFilesPageInfo">>;
export type CheckedDiscussionChannelFields = Required<Pick<DiscussionChannelResolvers<GraphQLContext>, "detailAnswersPageInfo">>;
export type CheckedAuthorFields = CommentAuthorResolvers<GraphQLContext>;
export type CheckedIssueAuthorFields = IssueAuthorResolvers<GraphQLContext>;
export type CheckedDownloadableFileFields = Required<Pick<DownloadableFileResolvers<GraphQLContext>, "url">>;
export type CheckedUserFields = { Collections: SelectedResolver<UserResolvers<GraphQLContext>["Collections"], typeof profileCollectionSelection> };
export const checkedTypeFieldGroups = [
  ["User", "checkedUser"], ["Album", "checkedAlbum"], ["Discussion", "checkedDiscussion"],
  ["DiscussionChannel", "checkedDiscussionChannel"],
  ["CommentAuthor", "checkedCommentAuthor"], ["IssueAuthor", "checkedIssueAuthor"],
  ["DownloadableFile", "checkedDownloadableFile"],
] as const;
export const checkedTypeFieldNames = [
  "User.Collections", "Album.detailImagesPageInfo", "Discussion.detailFilesPageInfo", "DiscussionChannel.detailAnswersPageInfo",
  "CommentAuthor.__resolveType", "IssueAuthor.__resolveType", "DownloadableFile.url",
] as const;
