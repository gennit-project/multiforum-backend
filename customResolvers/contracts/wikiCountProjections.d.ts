import type { Integer } from "neo4j-driver";
/** Exact fixed maps shared by ordinary and featured queries. Persisted scalar
 * values and native dates remain raw until selected GraphQL completion. */
export type WikiListItemSource={
 id:unknown;title:unknown;body:unknown;slug:unknown;channelUniqueName:unknown;
 createdAt:unknown;updatedAt:unknown;
 VersionAuthor:{username:unknown;displayName:unknown;profilePicURL:unknown}|null;
};
export type WikiCountRow = {totalCount: Integer | number; wikiPage: WikiListItemSource};
export type FeaturedWikiRow = {wikiPage: WikiListItemSource};
