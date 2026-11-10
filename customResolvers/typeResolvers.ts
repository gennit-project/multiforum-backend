import { discussionListFlairs } from "./fields/discussionListFlairs.js";
import type { DiscussionListFlairSource } from "./contracts/discussionListFlairs.js";
import { discussionListViewerVotes } from "./fields/discussionListViewerVotes.js";
import { authorSourceType } from "../services/authorSourceType.js";
import type { DiscussionChannelResolvers, SiteWideDiscussionListItemResolvers, CommentResolvers, AlbumResolvers, ScratchpadEntryResolvers } from "../src/generated/graphql.js";
import type { OpaqueListSource } from "./contracts/deferredSources.js";
import type { UserResolvers, ImageResolvers, ChannelResolvers } from "../src/generated/graphql.js";
import type { GraphQLContext } from "../types/context.js";
import type { VariantUrlsDomainResolver } from "./contracts/variantUrlsDomain.js";
// Type/interface and object-field resolvers (union __resolveType discriminators,
// the JSON scalar, and empty-array fallbacks). Extracted from customResolvers.ts.
import GraphQLJSON from "graphql-type-json";
import type { CheckedDiscussionListVotes, CheckedAlbumFields, CheckedDiscussionFields, CheckedDiscussionChannelFields, CheckedAuthorFields, CheckedIssueAuthorFields, CheckedDownloadableFileFields, CheckedUserFields } from "./contracts/typeFields.js";
import type { ResolverDeps } from "./resolverDeps.js";
import userCollections from "./fields/userCollections.js";
import createDownloadableFileUrlResolver from "./fields/downloadableFileUrl.js";
import emptyArrayFallback from "./fields/emptyArrayFallback.js";
import { createVariantUrlsResolver } from "./fields/variantUrls.js";
import {
  encodeDetailCollectionCursor,
  type DetailCollectionKind,
} from "../services/detailCollectionCursor.js";

type DetailCollectionItem = {
  createdAt?: unknown;
  id?: string;
};

const detailCollectionPageInfo = <CollectionKey extends string, NextKey extends string>({
  collectionKey,
  hasNextPageKey,
  kind,
}: {
  collectionKey: CollectionKey;
  hasNextPageKey: NextKey;
  kind: DetailCollectionKind;
}) => (parent: { [Key in CollectionKey]?: DetailCollectionItem[] | null } & { [Key in NextKey]?: unknown }) => {
  const value = parent[collectionKey];
  const collection = Array.isArray(value) ? value : [];
  const lastItem = collection[collection.length - 1];
  const createdAt = lastItem?.createdAt ? String(lastItem.createdAt) : "";
  const id = lastItem?.id;

  const hasNextPage: unknown = parent[hasNextPageKey];
  return {
    endCursor:
      createdAt && id
        ? encodeDetailCollectionCursor({ kind, createdAt, id })
        : null,
    hasNextPage: hasNextPage === true,
  };
};

const imageVariantUrls = createVariantUrlsResolver({
  list80: "list80Url",
  list160: "list160Url",
  list320: "list320Url",
  detail640: "detail640Url",
  detail960: "detail960Url",
  detail1280: "detail1280Url",
});

const userVariantUrls = createVariantUrlsResolver({
  avatar32: "avatar32Url",
  avatar48: "avatar48Url",
  avatar64: "avatar64Url",
  avatar96: "avatar96Url",
});

const channelVariantUrls = createVariantUrlsResolver({
  avatar32: "icon32Url",
  avatar48: "icon48Url",
  avatar64: "icon64Url",
  avatar96: "icon96Url",
});

export default function buildTypeResolvers(deps: ResolverDeps) {
  const { driver } = deps;

  const checkedCommentAuthor = {
    __resolveType(obj: { username?: unknown; displayName?: unknown }) {
      const source = authorSourceType(obj);
      if (source.found) return source.value;
      if (obj.username) return "User";
      if (obj.displayName) return "ModerationProfile";
      return "User";
    },
  } satisfies CheckedAuthorFields;
  const checkedIssueAuthor = {
    __resolveType(obj: { username?: unknown; displayName?: unknown }) {
      const source = authorSourceType(obj);
      if (source.found) return source.value;
      if (obj.username) return "User";
      if (obj.displayName) return "ModerationProfile";
      return "User";
    },
  } satisfies CheckedIssueAuthorFields;
  const checkedAlbum = {
    detailImagesPageInfo: detailCollectionPageInfo({ collectionKey: "Images", hasNextPageKey: "_detailImagesHasNextPage", kind: "image" }),
  } satisfies CheckedAlbumFields;
  const checkedDiscussion = {
    detailFilesPageInfo: detailCollectionPageInfo({ collectionKey: "DownloadableFiles", hasNextPageKey: "_detailFilesHasNextPage", kind: "file" }),
  } satisfies CheckedDiscussionFields;
  const checkedDiscussionChannel = {
    detailAnswersPageInfo: detailCollectionPageInfo({ collectionKey: "Answers", hasNextPageKey: "_detailAnswersHasNextPage", kind: "answer" }),
  } satisfies CheckedDiscussionChannelFields;
  const checkedDiscussionListVotes = {
    UpvotedByUsers: discussionListViewerVotes('UpvotedByUsers'),
    SuperUpvotedByUsers: discussionListViewerVotes('SuperUpvotedByUsers'),
  } satisfies CheckedDiscussionListVotes;
  const checkedUser = { Collections: userCollections({ driver }) } satisfies CheckedUserFields;
  const checkedDownloadableFile = {
    url: createDownloadableFileUrlResolver(),
  } satisfies CheckedDownloadableFileFields;

  return {
    JSON: GraphQLJSON,
    CommentAuthor: { ...checkedCommentAuthor },
    IssueAuthor: { ...checkedIssueAuthor },
    User: {
      ...checkedUser,
      variantUrls: userVariantUrls satisfies VariantUrlsDomainResolver<UserResolvers<GraphQLContext>["variantUrls"]>,
    },
    Image: {
      variantUrls: imageVariantUrls satisfies VariantUrlsDomainResolver<ImageResolvers<GraphQLContext>["variantUrls"]>,
    },
    DownloadableFile: {
      ...checkedDownloadableFile,
    },
    DiscussionChannel: {
      SuperUpvotedByUsers: emptyArrayFallback('SuperUpvotedByUsers') satisfies OpaqueListSource<DiscussionChannelResolvers<GraphQLContext>["SuperUpvotedByUsers"]>,
      ...checkedDiscussionChannel,
    },
    DiscussionChannelListItem: {
      Flairs: discussionListFlairs satisfies DiscussionListFlairSource,
      ...checkedDiscussionListVotes,
    },
    SiteWideDiscussionListItem: {
      DownloadableFiles: emptyArrayFallback('DownloadableFiles') satisfies OpaqueListSource<SiteWideDiscussionListItemResolvers<GraphQLContext>["DownloadableFiles"]>,
    },
    Comment: {
      SuperUpvotedByUsers: emptyArrayFallback('SuperUpvotedByUsers') satisfies OpaqueListSource<CommentResolvers<GraphQLContext>["SuperUpvotedByUsers"]>,
    },
    ScratchpadEntry: {
      superUpvotedByUsers: ((parent: { superUpvotedByUsers?: unknown[] | null }) =>
        parent.superUpvotedByUsers || []) satisfies OpaqueListSource<ScratchpadEntryResolvers<GraphQLContext>["superUpvotedByUsers"]>,
    },
    Album: {
      Images: emptyArrayFallback('Images') satisfies OpaqueListSource<AlbumResolvers<GraphQLContext>["Images"]>,
      ...checkedAlbum,
    },
    Discussion: {
      ...checkedDiscussion,
    },
    Channel: {
      variantUrls: channelVariantUrls satisfies VariantUrlsDomainResolver<ChannelResolvers<GraphQLContext>["variantUrls"]>,
      Moderators: emptyArrayFallback('Moderators') satisfies OpaqueListSource<ChannelResolvers<GraphQLContext>["Moderators"]>,
      Admins: emptyArrayFallback('Admins') satisfies OpaqueListSource<ChannelResolvers<GraphQLContext>["Admins"]>,
      Bots: emptyArrayFallback('Bots') satisfies OpaqueListSource<ChannelResolvers<GraphQLContext>["Bots"]>,
      Tags: emptyArrayFallback('Tags') satisfies OpaqueListSource<ChannelResolvers<GraphQLContext>["Tags"]>,
      PendingOwnerInvites: emptyArrayFallback('PendingOwnerInvites') satisfies OpaqueListSource<ChannelResolvers<GraphQLContext>["PendingOwnerInvites"]>,
      PendingModInvites: emptyArrayFallback('PendingModInvites') satisfies OpaqueListSource<ChannelResolvers<GraphQLContext>["PendingModInvites"]>,
      RelatedChannels: emptyArrayFallback('RelatedChannels') satisfies OpaqueListSource<ChannelResolvers<GraphQLContext>["RelatedChannels"]>,
      PinnedDiscussionChannels: emptyArrayFallback('PinnedDiscussionChannels') satisfies OpaqueListSource<ChannelResolvers<GraphQLContext>["PinnedDiscussionChannels"]>,
      PinnedWikiPages: emptyArrayFallback('PinnedWikiPages') satisfies OpaqueListSource<ChannelResolvers<GraphQLContext>["PinnedWikiPages"]>,
      InCollections: emptyArrayFallback('InCollections') satisfies OpaqueListSource<ChannelResolvers<GraphQLContext>["InCollections"]>,
      EventChannels: emptyArrayFallback('EventChannels') satisfies OpaqueListSource<ChannelResolvers<GraphQLContext>["EventChannels"]>,
      DiscussionChannels: emptyArrayFallback('DiscussionChannels') satisfies OpaqueListSource<ChannelResolvers<GraphQLContext>["DiscussionChannels"]>,
      Comments: emptyArrayFallback('Comments') satisfies OpaqueListSource<ChannelResolvers<GraphQLContext>["Comments"]>,
      SuspendedUsers: emptyArrayFallback('SuspendedUsers') satisfies OpaqueListSource<ChannelResolvers<GraphQLContext>["SuspendedUsers"]>,
      SuspendedMods: emptyArrayFallback('SuspendedMods') satisfies OpaqueListSource<ChannelResolvers<GraphQLContext>["SuspendedMods"]>,
    },
  };
}
