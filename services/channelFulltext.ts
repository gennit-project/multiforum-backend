// Shared definitions for the Channel full-text search index.
//
// The index itself is declared in `typeDefs.ts` via the `@neo4j/graphql`
// `@fulltext` directive and created on startup by `ensureSchemaConstraints`
// (which runs `assertIndexesAndConstraints({ create: true })`). The directive
// generates exactly `CREATE FULLTEXT INDEX channelFulltext IF NOT EXISTS FOR
// (n:Channel) ON EACH [n.uniqueName, n.description]`.
//
// The constants below let application code (the `getSortedChannels` resolver)
// and the integration-test harness reference that same index by name without
// re-parsing the SDL. Keep `CHANNEL_FULLTEXT_INDEX` in sync with the
// `indexName` argument on the `@fulltext` directive in `typeDefs.ts`.

export const CHANNEL_FULLTEXT_INDEX = "channelFulltext";

// The fields the index covers. Kept alongside the name purely for the harness's
// standalone CREATE statement; production derives these from the directive.
export const CHANNEL_FULLTEXT_FIELDS = ["uniqueName", "description"] as const;

// Mirrors the statement the `@fulltext` directive emits. Used by the
// integration-test harness, which wires resolvers directly and therefore does
// not run the OGM's schema-constraint bootstrap. Production never uses this.
export const CHANNEL_FULLTEXT_CREATE_CYPHER = `CREATE FULLTEXT INDEX ${CHANNEL_FULLTEXT_INDEX} IF NOT EXISTS FOR (n:Channel) ON EACH [${CHANNEL_FULLTEXT_FIELDS.map(
  (f) => `n.${f}`
).join(", ")}]`;

// Lucene query-syntax metacharacters. User input must be escaped so a stray
// character (e.g. a `-` or `:`) is matched literally instead of being parsed as
// a query operator, which would throw or silently change the search.
const LUCENE_SPECIAL_CHARS = /[+\-&|!(){}[\]^"~*?:\\/]/g;

// Builds a Lucene query string for the channel full-text index that reproduces
// the old `CONTAINS` typeahead feel: each whitespace-separated term is escaped
// and given a trailing `*` so a partial term ("dog") still matches a longer
// token ("dogs"). Terms are AND-ed so multi-word input narrows results, the way
// a single substring scan used to. Returns "" when the input has no searchable
// characters, letting callers fall back to the unfiltered path.
export function buildChannelFulltextQuery(searchInput: string): string {
  return searchInput
    .trim()
    .split(/\s+/)
    .map((term) => term.replace(LUCENE_SPECIAL_CHARS, "\\$&"))
    .filter((term) => term.length > 0)
    .map((term) => `${term}*`)
    .join(" AND ");
}
