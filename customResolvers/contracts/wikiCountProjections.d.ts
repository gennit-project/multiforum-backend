import type { Integer } from "neo4j-driver";
/** COUNT is the only proven scalar here. All wiki properties, including
 * featured IDs drawn from persisted server configuration, remain unknown. */
export type WikiCountRow = {totalCount: Integer | number; wikiPage: Record<string, unknown>};
export type FeaturedWikiRow = {wikiPage: Record<string, unknown>};
