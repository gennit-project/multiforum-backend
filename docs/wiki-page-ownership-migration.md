# Wiki page ownership migration

Wiki pages are owned by exactly one channel through
`(Channel)-[:OWNS_WIKI_PAGE]->(WikiPage)`. The stored `channelUniqueName` remains
as an immutable route key so Neo4j can enforce unique
`(channelUniqueName, slug)` routes.

Run the audit before deploying the schema change:

```sh
pnpm migrate:wiki-page-ownership
```

The dry run reports:

- pages without an owner relationship;
- route keys whose channel no longer exists;
- pages with multiple or mismatched owners;
- missing route identity fields; and
- duplicate routes within one channel.

Orphaned pages are repairable automatically only when their stored channel key
resolves to exactly one channel and no other unsafe condition exists. Fix any
reported ambiguity or duplicate route first, then apply the backfill:

```sh
pnpm migrate:wiki-page-ownership -- --apply
```

The apply step runs in one write transaction and is idempotent. It refuses to
write if any unsafe records remain. Re-run the dry run afterward, then run
`pnpm neo4j:audit`. Deployment creates the `wiki_page_route_unique` constraint;
Enterprise uses a node key (existence plus uniqueness), while Community uses
the supported composite uniqueness constraint and the GraphQL schema requires
both route fields.
