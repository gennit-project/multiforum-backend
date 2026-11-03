import type { UserResolvers, ImageResolvers, ChannelResolvers } from "../src/generated/graphql.js";
import type { GraphQLContext } from "../types/context.js";
import type { VariantUrlsDomainResolver } from "./contracts/variantUrlsDomain.js";
// Type/interface and object-field resolvers (union __resolveType discriminators,
// the JSON scalar, and empty-array fallbacks). Extracted from customResolvers.ts.
import GraphQLJSON from "graphql-type-json";
import type { CheckedAlbumFields, CheckedDiscussionFields, CheckedDiscussionChannelFields, CheckedAuthorFields, CheckedIssueAuthorFields, CheckedDownloadableFileFields, CheckedUserFields } from "./contracts/typeFields.js";
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
      if (obj.username) return "User";
      if (obj.displayName) return "ModerationProfile";
      return "User";
    },
  } satisfies CheckedAuthorFields;
  const checkedIssueAuthor = {
    __resolveType(obj: { username?: unknown; displayName?: unknown }) {
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
      SuperUpvotedByUsers: emptyArrayFallback('SuperUpvotedByUsers'),
      ...checkedDiscussionChannel,
    },
    DiscussionChannelListItem: {
      Flairs: emptyArrayFallback('Flairs'),
      SuperUpvotedByUsers: emptyArrayFallback('SuperUpvotedByUsers'),
      UpvotedByUsers: emptyArrayFallback('UpvotedByUsers'),
    },
    SiteWideDiscussionListItem: {
      DownloadableFiles: emptyArrayFallback('DownloadableFiles'),
    },
    Comment: {
      SuperUpvotedByUsers: emptyArrayFallback('SuperUpvotedByUsers'),
    },
    ScratchpadEntry: {
      superUpvotedByUsers: (parent: { superUpvotedByUsers?: unknown[] }) =>
        parent.superUpvotedByUsers || [],
    },
    Album: {
      Images: emptyArrayFallback('Images'),
      ...checkedAlbum,
    },
    Discussion: {
      ...checkedDiscussion,
    },
    Channel: {
      variantUrls: channelVariantUrls satisfies VariantUrlsDomainResolver<ChannelResolvers<GraphQLContext>["variantUrls"]>,
      Moderators: emptyArrayFallback('Moderators'),
      Admins: emptyArrayFallback('Admins'),
      Bots: emptyArrayFallback('Bots'),
      Tags: emptyArrayFallback('Tags'),
      PendingOwnerInvites: emptyArrayFallback('PendingOwnerInvites'),
      PendingModInvites: emptyArrayFallback('PendingModInvites'),
      RelatedChannels: emptyArrayFallback('RelatedChannels'),
      PinnedDiscussionChannels: emptyArrayFallback('PinnedDiscussionChannels'),
      PinnedWikiPages: emptyArrayFallback('PinnedWikiPages'),
      InCollections: emptyArrayFallback('InCollections'),
      EventChannels: emptyArrayFallback('EventChannels'),
      DiscussionChannels: emptyArrayFallback('DiscussionChannels'),
      Comments: emptyArrayFallback('Comments'),
      SuspendedUsers: emptyArrayFallback('SuspendedUsers'),
      SuspendedMods: emptyArrayFallback('SuspendedMods'),
    },
  };
}
