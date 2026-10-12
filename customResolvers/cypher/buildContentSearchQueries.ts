import {
  getSiteWideIssuesQuery,
  getSiteWideWikiPagesQuery,
} from "./cypherQueries.js";

const replaceAnchors = (
  query: string,
  anchor: RegExp,
  replacement: string
) => query.replace(anchor, replacement);

export const buildSiteWideIssuesQuery = (hasSearch: boolean): string =>
  hasSearch
    ? replaceAnchors(
        getSiteWideIssuesQuery,
        /^MATCH \(issue:Issue\)$/gm,
        "CALL db.index.fulltext.queryNodes($fulltextIndex, $fulltextQuery) YIELD node AS issue"
      )
    : getSiteWideIssuesQuery;

export const buildSiteWideWikiPagesQuery = (hasSearch: boolean): string =>
  hasSearch
    ? replaceAnchors(
        getSiteWideWikiPagesQuery,
        /^MATCH \(owner:Channel\)-\[:OWNS_WIKI_PAGE\]->\(w:WikiPage\)$/gm,
        "CALL db.index.fulltext.queryNodes($fulltextIndex, $fulltextQuery) YIELD node AS w\nMATCH (owner:Channel)-[:OWNS_WIKI_PAGE]->(w)"
      )
    : getSiteWideWikiPagesQuery;
