// Type/interface and object-field resolvers (union __resolveType discriminators,
// the JSON scalar, and empty-array fallbacks). Extracted from customResolvers.ts.
import GraphQLJSON from "graphql-type-json";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../types/context.js";
import type { ResolverDeps } from "./resolverDeps.js";
import userCollections from "./fields/userCollections.js";
import createDownloadableFileUrlResolver from "./fields/downloadableFileUrl.js";
import emptyArrayFallback from "./fields/emptyArrayFallback.js";
import { createVariantUrlsResolver } from "./fields/variantUrls.js";

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
  const { ogm } = deps;

  return {
    JSON: GraphQLJSON,
    CommentAuthor: {
      __resolveType(obj: unknown, context: GraphQLContext, info: GraphQLResolveInfo) {
        const author = obj as { username?: string; displayName?: string };
        if (author.username) {
          return "User";
        }
        // Both user and mod profiles have this field so the order matters.
        if (author.displayName) {
          return "ModerationProfile";
        }
        return "User";
      },
    },
    IssueAuthor: {
      __resolveType(obj: unknown, context: GraphQLContext, info: GraphQLResolveInfo) {
        const author = obj as { username?: string; displayName?: string };
        if (author.username) {
          return "User";
        }
        // Both user and mod profiles have this field so the order matters.
        if (author.displayName) {
          return "ModerationProfile";
        }
        return "User";
      },
    },
    User: {
      Collections: userCollections({ ogm }),
      variantUrls: userVariantUrls,
    },
    Image: {
      variantUrls: imageVariantUrls,
    },
    DownloadableFile: {
      url: createDownloadableFileUrlResolver(),
    },
    DiscussionChannel: {
      SuperUpvotedByUsers: emptyArrayFallback('SuperUpvotedByUsers'),
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
    },
    Channel: {
      variantUrls: channelVariantUrls,
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
