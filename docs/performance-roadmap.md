# Performance Roadmap

A living backlog of backend performance work, written so it can be picked up
later without re-deriving the reasoning. It came out of a five-dimension audit
(indexes, N+1 queries, Cypher, authorization overhead, server/driver config) in
July 2026.

Two things to keep in mind before spending effort here:

1. **These are mostly "at scale" problems.** The findings are from static
   analysis of the code, not from a slow production instance. Several items only
   bite once data volume grows (large tables, many channels, lots of content).
   At the current size the app may be perfectly fast. **Prioritise by observed
   pain**, not by this list's order — see [When to revisit](#when-to-revisit).
2. **Measure before investing.** Before doing any of the medium/large items,
   confirm it's actually slow (see [How to measure](#how-to-measure)). The one
   exception is index verification (#1) — it's cheap enough to just check.

## Already done (for context)

| Change | PR | Effect |
| --- | --- | --- |
| Removed per-mutation Slack webhook (was awaited on the write path) | #130 | Every mutation was blocked on a 3rd-party HTTP call; gone. |
| Memoized auth identity + ServerConfig lookups (request-scoped) | #130 | A mutation went from ~8–12 redundant identity/config queries to ~2. |
| Request-cached server-suspension lookups | #134 | Suspension re-queried per rule → once per request. |
| GraphQL query **depth limit** | #131 | Rejects pathologically deep queries before they hit the DB. |
| gzip responses | #132 | Compresses payloads (list responses benefit most). |

Also **decided against**: routing reads to Neo4j `READ` replicas. It looks like a
free win but breaks read-your-own-writes on a causal cluster without bookmark
plumbing — see the "Neo4j session routing" note in
[architecture.md](./architecture.md). Revisit only as part of a real cluster
migration.

---

## The remaining backlog

Each item: what it is in plain terms, why it matters, the symptom that means
"do this now", how to do it, and rough effort/risk.

### 1. Verify (and if needed, create) database indexes — *do this first*

- **Plain terms:** An index lets Neo4j jump straight to a node by a property
  (e.g. a user by `username`) instead of scanning every node of that label. The
  audit suspects the app's `@unique` constraints (which carry indexes for
  `username`, channel `uniqueName`, `Tag.text`, moderator `displayName`) may
  never be created at runtime: `assertIndexesAndConstraints()` is called without
  `{ options: { create: true } }` **and** only when the DB edition is
  "enterprise" ([index.ts](../index.ts)). Also, `@id` fields create **no** index
  in `@neo4j/graphql` v5.
- **Why it matters:** if the indexes are missing, the *most common* lookups in
  the app (load a profile, open a channel, filter by tag) do a full label scan.
  This is the highest-leverage, lowest-effort fix in the whole roadmap — *if*
  it's real.
- **Symptom:** any lookup-by-name feels slow; `PROFILE` on a `MATCH (:User {username})`
  shows a `NodeByLabelScan` instead of a `NodeIndexSeek`.
- **How:**
  1. **Verify first** against the real database: `SHOW CONSTRAINTS;` and
     `SHOW INDEXES;` in the Neo4j browser/cypher-shell. (Can also be checked
     locally by applying the schema to a Testcontainers Neo4j.) If the
     constraints already exist — created out-of-band at some point — this whole
     item is moot; cross it off.
  2. If missing: call `assertIndexesAndConstraints({ options: { create: true } })`
     at startup, **un-gated** from the enterprise check (constraint/index
     creation works on Community; only NODE KEY constraints are enterprise-only).
  3. Add explicit range indexes for the hot fields `@unique` doesn't cover:
     `DiscussionChannel.channelUniqueName`, `DiscussionChannel.id`,
     `Discussion.createdAt`, `Issue.createdAt`/`isOpen`, `Event.startTime`.
- **Effort:** low (verification + a few `CREATE INDEX IF NOT EXISTS`). **Risk:**
  low — creating indexes is safe, though on a large prod DB do it in a
  maintenance window (index build can take time). **Caveat:** date-window filters
  currently wrap the string field in `datetime(...)`, which defeats a range index
  even if one exists — getting index-backed date filtering also needs #4-style
  work (store `createdAt` as a native datetime). Feeds into #2 and #3.

### 2. Pagination limits on list queries

- **Plain terms:** List queries (`discussions`, `comments`, `events`, …) have no
  default or maximum page size. A client that forgets to ask for a page can
  fetch the entire table in one request.
- **Why it matters:** as content grows, one such query fetches and serialises
  thousands of nodes → memory and latency spikes; big `SKIP` offsets get slow.
- **Symptom:** a list endpoint returns huge responses / slows down as data grows;
  memory spikes under load.
- **How:** add the `@limit(default: 25, max: 100)` directive to list-returning
  types in [typeDefs.ts](../typeDefs.ts); and clamp the client-supplied
  `limit`/`offset` in the custom Cypher list resolvers (e.g.
  `getSiteWideDiscussionList`). **Check the frontend's largest real page size
  first** so the `max` doesn't cut off a legitimate query.
- **Effort:** medium (touches many types, mechanical). **Risk:** medium — a
  client asking for more than `max` gets capped, so verify real page sizes.

### 3. Full-text search instead of regex scans

- **Plain terms:** Site-wide search filters with a case-insensitive regex —
  `WHERE title =~ '(?i).*term.*'` — on `title` **and** `body`. A leading-wildcard
  regex can't use any index, so every search scans every node of the label and
  runs the regex on each (including large `body` fields).
- **Why it matters:** search cost is O(all content) and gets worse as content
  grows. (There's also a raw-regex-injection concern — the search term is
  interpolated straight into the pattern.)
- **Symptom:** search is slow / slows with content growth.
- **How:** declare `@fulltext` indexes on `Discussion(title, body)`,
  `WikiPage(title, body)`, `Issue`, and switch the search resolvers to
  `CALL db.index.fulltext.queryNodes(...)`. **Depends on #1** (the index must be
  created). Note: full-text tokenises (word matching) rather than substring
  matching, so match behaviour changes slightly — worth a product check.
- **Effort:** medium–high (schema + rewrite the search branch of several
  resolvers). **Risk:** medium (search result/ranking behaviour changes).

### 4. Rewrite "collect everything, then paginate" queries

- **Plain terms:** A few queries compute results for *all* rows and then keep
  only one page — in JavaScript, after the DB already did the full work. The
  clearest case is `getServerHealthDashboard`: it scans every channel and runs
  ~8 correlated sub-queries per channel, collects the lot, then `.slice(0, limit)`
  in JS. `getSortedChannels` collects all channels, then applies `SKIP`/`LIMIT`
  *after*.
- **Why it matters:** the cost grows with **total server size** to render a
  single page. This is the query that scales worst as the instance grows.
- **Symptom:** the admin health dashboard / channel list gets slow as the number
  of channels and their content grows.
- **How:** push sort + `SKIP`/`LIMIT` into Cypher **before** building the heavy
  per-row data — paginate the cheap list first, then compute the expensive
  per-item stats only for the page that's actually returned.
- **Effort:** medium–high (careful Cypher rewrites, one query at a time).
  **Risk:** medium — rewritten Cypher must return identical results; rely on the
  existing integration tests (`getSortedChannels.test.ts`,
  `serverHealthDashboard.test.ts`) and `PROFILE` before/after.

### 5. Smaller / opportunistic items

- **Query cost/complexity analysis.** The depth limit (#131, done) stops *deep*
  queries but not *wide*, shallow-but-expensive ones. A complexity plugin
  (`graphql-query-complexity`) assigns each field a cost and rejects overly
  expensive queries. Medium effort (need sensible cost estimates).
- **Batch per-item write loops.** A few mutations issue one query per item in a
  loop — `createEventSeriesWithChannelConnections` (per occurrence × channel),
  `refreshPlugins`, the mention-notification hooks. Rewrite with `UNWIND $rows`
  so it's one round-trip. Low–medium effort each; matters for large inputs
  (a year-long event series, a big plugin registry).
- **Move expired-suspension cleanup off the auth path.** Permission checks
  currently fire a fire-and-forget *write* (disconnecting expired suspensions)
  during authorization. Move it to the existing background service loop so reads
  don't trigger writes. Low–medium effort.
- **Connection-pool tuning.** The Neo4j driver uses all defaults
  (`connectionAcquisitionTimeout` 60s, etc.). Under load, requests can queue up
  to 60s instead of failing fast. The right values depend on the Neo4j instance's
  limits — **an infra tuning decision**, best made with knowledge of the
  deployment.
- **Disable introspection in production.** Apollo leaves schema introspection +
  the landing page on by default. Turning them off in prod is a **security
  posture** decision (some tooling relies on introspection), so it's flagged
  rather than assumed.
- **Store timestamps as native datetime.** Date-window filters wrap string
  `createdAt` in `datetime(...)`, which prevents index use. Storing timestamps
  natively (or as epoch millis) unlocks index-backed date filtering. Cross-cutting
  (schema + data migration + query changes) — larger, do only if date-filtered
  feeds are a measured bottleneck.

---

## Recommended sequence

If/when you come back to this, roughly this order gives the most value per unit
of effort and respects dependencies:

1. **#1 Verify indexes.** Cheap, and potentially the biggest single win. It also
   tells you whether #2/#3 assumptions hold. Just check — then fix or cross off.
2. **#2 Pagination limits.** Bounds worst-case query cost and response size; a
   good safety measure independent of current pain.
3. **#3 Full-text search.** Turns the slowest search path from "scan everything"
   into an indexed lookup. Depends on #1.
4. **#4 Collect-then-paginate rewrites.** Highest effort; do it when the instance
   is large enough that the health dashboard / channel list is actually felt.
5. **#5 items** opportunistically, as capacity allows or as a specific one starts
   to hurt.

## How to measure

Before investing in #2–#5, confirm the target is actually slow:

- **`PROFILE <query>`** in the Neo4j browser / cypher-shell shows the query plan
  and `db hits`. Look for `NodeByLabelScan` (no index), large `Filter` rows, and
  high total db hits. Run it before and after a change to prove the win.
- **Slow query logging** — Neo4j can log queries over a threshold
  (`db.logs.query.*`); turn it on to find the real offenders.
- **Request-level latency** — add/inspect APM (or the existing logger's timing)
  to see which GraphQL operations are slow in practice.

The list above is a hypothesis of where the cost *is*; measurement tells you
where it's *felt*. Spend effort where the two agree.

## When to revisit

Concrete triggers that mean an item has become worth doing:

- Lookups by name/handle feel sluggish, or `PROFILE` shows label scans → **#1**.
- A list endpoint returns very large responses or slows as data grows → **#2**.
- Search latency climbs with content volume → **#3**.
- The admin health dashboard or channel listing slows as channels multiply → **#4**.
- You outgrow a single Neo4j instance and add read replicas → revisit read
  routing + bookmark propagation (see [architecture.md](./architecture.md)).
