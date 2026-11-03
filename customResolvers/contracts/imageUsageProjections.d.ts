/** Exact Cypher map structure. Persisted leaves deliberately remain unknown. */
type Identity = {username:unknown;displayName:unknown};
export type ImageUsageDiscussion = {id:unknown;title:unknown;createdAt:string|null;Author:Identity|null;DiscussionChannels:{id:unknown;channelUniqueName:unknown}[]};
export type ImageUsageAlbum = {id:unknown;imageOrder:unknown;Owner:Identity|null;Discussions:ImageUsageDiscussion[]};
export type ImageUsageRow = {usage:{imageId:string;uploaderUsername:unknown;uploaderOwnedAlbums:ImageUsageAlbum[];otherAlbums:ImageUsageAlbum[]}};
