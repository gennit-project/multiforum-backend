import type { Collection, User, Channel } from "../../src/generated/graphql.js";
import type { Projection, Selection } from "./selection.js";
export const profileCollectionSelection = {
  id: true, name: true, description: true, visibility: true, collectionType: true,
  itemCount: true, itemOrder: true, createdAt: true, updatedAt: true,
  Channels: { uniqueName: true, displayName: true, channelIconURL: true },
  Discussions: { id: true, title: true }, Comments: { id: true, text: true },
  Downloads: { id: true, title: true }, Images: { id: true, url: true },
} as const satisfies Selection<Collection>;
export type ProfileCollectionProjection = Projection<Collection, typeof profileCollectionSelection>;
export const publicCollectionSelection = {
  id: true, name: true, description: true, visibility: true, collectionType: true,
  itemCount: true, shareCount: true, createdAt: true, updatedAt: true, itemOrder: true,
  CreatedBy: { username: true, displayName: true, profilePicURL: true },
  Downloads: {
    id: true, title: true, createdAt: true, hasSensitiveContent: true,
    Album: { id: true, imageOrder: true, Images: { id: true, url: true, caption: true } },
    DiscussionChannels: { id: true, channelUniqueName: true, CommentsConnection: { aggregate: { count: { nodes: true } } }, Channel: { uniqueName: true, displayName: true } },
    Tags: { text: true }, Author: { username: true, displayName: true, profilePicURL: true, commentKarma: true, discussionKarma: true, createdAt: true },
  },
} as const satisfies Selection<Collection>;
export type PublicCollectionProjection = Projection<Collection, typeof publicCollectionSelection>;
export const profileImageSelection = { username: true, profilePicURL: true, variantUrls: true, avatar32Url: true, avatar48Url: true, avatar64Url: true, avatar96Url: true } as const satisfies Selection<User>;
export type ProfileImageProjection = Projection<User, typeof profileImageSelection>;
export const channelIconSelection = { uniqueName: true, channelIconURL: true, variantUrls: true, icon32Url: true, icon48Url: true, icon64Url: true, icon96Url: true } as const satisfies Selection<Channel>;
export type ChannelIconProjection = Projection<Channel, typeof channelIconSelection>;
