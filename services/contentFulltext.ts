// Keep these names and fields in sync with the @fulltext directives in
// typeDefs.ts. Production creates them through ensureSchemaConstraints; the
// standalone integration harness uses the explicit statements below.
export const DISCUSSION_FULLTEXT_INDEX = "discussionFulltext";
export const ISSUE_FULLTEXT_INDEX = "issueFulltext";
export const WIKI_PAGE_FULLTEXT_INDEX = "wikiPageFulltext";

export const CONTENT_FULLTEXT_CREATE_STATEMENTS = [
  `CREATE FULLTEXT INDEX ${DISCUSSION_FULLTEXT_INDEX} IF NOT EXISTS FOR (n:Discussion) ON EACH [n.title, n.body]`,
  `CREATE FULLTEXT INDEX ${ISSUE_FULLTEXT_INDEX} IF NOT EXISTS FOR (n:Issue) ON EACH [n.title, n.body]`,
  `CREATE FULLTEXT INDEX ${WIKI_PAGE_FULLTEXT_INDEX} IF NOT EXISTS FOR (n:WikiPage) ON EACH [n.title, n.body]`,
] as const;
