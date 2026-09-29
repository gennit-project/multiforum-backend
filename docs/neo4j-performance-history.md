# Neo4j Performance History

This document explains how Multiforum's backend performance work evolved, what
was changed, and why those changes helped. It is intentionally more explanatory
than a changelog. Measurements are historical observations from the fixtures or
Aura state described in each PR, not permanent guarantees.

For current status, see [performance-roadmap.md](./performance-roadmap.md).

## The original symptoms

In September 2026, opening a discussion or navigating to a forum list could take
roughly 8–12 seconds. The database held only about 1,500 nodes, so “there is too
much data” was not a credible explanation.

The investigation separated several possible causes:

- frontend JavaScript chunks generally arrived quickly;
- the Heroku dyno did not sleep;
- a trivial Aura `RETURN 1` round trip was about 31 ms;
- small GraphQL operations became slow in bursts when a page fired several
  operations together;
- representative queries created thousands of intermediate rows or spent more
  time being planned than executed.

The central lesson was:

> A small result and a small database do not guarantee a cheap query. Query
> shape determines how much intermediate work Neo4j performs.

## Phase 1: make the delay observable

[Backend PR #264](https://github.com/gennit-project/multiforum-backend/pull/264)
added per-operation timing for queue, GraphQL parse/validate/execute, summed
Neo4j time, database call count, and event-loop delay. The same information is
available through `Server-Timing`.

### Why this mattered

Before this work, an eight-second request was simply “the backend is slow.” The
new breakdown distinguishes:

- waiting for a busy Node.js event loop;
- GraphQL planning/authorization/resolver CPU;
- actual Neo4j calls;
- many sequential database round trips.

That prevents a common mistake: rewriting Cypher when the bottleneck is
actually request queuing, or optimizing frontend rendering when the browser is
waiting for the API.

## Phase 2: remove repeated age-gate planning work

Age-gate authorization originally expanded relationship traversals inside many
generated queries. Even when execution found little data, Neo4j still had to
plan a very large statement.

- [PR #266](https://github.com/gennit-project/multiforum-backend/pull/266)
  added missing uniqueness constraints on six ID fields. One production plan
  had checked 97 images for each of 67 issues: 6,499 rows for one lookup shape.
- [PR #267](https://github.com/gennit-project/multiforum-backend/pull/267)
  cached the nearly static age policy for 30 seconds instead of loading it from
  Neo4j once per request.
- [PR #269](https://github.com/gennit-project/multiforum-backend/pull/269)
  extended that protection to every remaining `@id` field. Since Neo4j
  GraphQL 4, `@id` generates values but does not itself guarantee uniqueness.
- [PR #270](https://github.com/gennit-project/multiforum-backend/pull/270)
  introduced the stored `ageGateRestricted` flag and a dry-run-first sweep.
- [PR #272](https://github.com/gennit-project/multiforum-backend/pull/272)
  changed most age-gate reads from computed graph traversals to stored flags,
  guarded temporarily by an upgrade interlock.
- [PR #274](https://github.com/gennit-project/multiforum-backend/pull/274)
  reconciled touched content in the same write transaction, so content and its
  visibility flag commit or roll back together.
- [PR #278](https://github.com/gennit-project/multiforum-backend/pull/278)
  covered relationship-only moves that generated timestamp stamping cannot see.
- [PR #279](https://github.com/gennit-project/multiforum-backend/pull/279)
  removed the temporary interlock after the write guarantees were deployed and
  observed.

For the same restricted-viewer `getIssue` operation, the generated Cypher
shrunk from 14,803 to 8,165 characters (45% smaller), and median Aura planning
time fell from 468 ms to 196 ms (58% lower) in the documented comparison.

### Plain-language explanation

The old approach re-answered “is this content sensitive?” by tracing its family
tree every time it appeared in a query. The new approach writes the answer onto
the content and carefully updates it whenever the graph changes. Reading a
boolean property is much cheaper than repeatedly reconstructing the answer.

One remaining public-collection path is tracked in
[issue #308](https://github.com/gennit-project/multiforum-backend/issues/308).

## Phase 3: fix the channel discussion list

The quilting forum was the clearest reproduction: a two-item response could
spend about ten seconds in database work.

### Work completed

- [PR #281](https://github.com/gennit-project/multiforum-backend/pull/281)
  added connection liveness checking, cached ranking settings, and moved the
  page boundary before heavy expansion.
- [PR #282](https://github.com/gennit-project/multiforum-backend/pull/282)
  added an index on `DiscussionChannel.channelUniqueName`.
- [PR #283](https://github.com/gennit-project/multiforum-backend/pull/283)
  split page selection from hydration and generated fixed query variants for
  only the active filters/sort mode.

The PR #283 Aura comparison reported the same IDs, order, count, and projected
records:

| Query               | Observed time |
| ------------------- | ------------: |
| Original cold query |        8.74 s |
| Split cold query    |        1.77 s |
| Split warm query    |  about 0.28 s |

### Why the index was not redundant

The existing connector node key was `(discussionId, channelUniqueName)`. A
composite index is ordered: it is useful when the query supplies the leading
property. The forum list knew only `channelUniqueName`, so it needed a separate
index with that property first.

This is like a phone book sorted by surname then given name: it does not help
much if all you know is a given name.

### Why fixed query variants helped

One universal statement contained conditions for every possible filter and
sort mode. Parameters disabled unused branches at execution time, but Neo4j
still had to understand and plan the full statement. The builder now chooses
from fixed, parameterized fragments so user values remain safe while inactive
branches are absent from the query text.

## Phase 4: establish a schema and integrity contract

[PR #285](https://github.com/gennit-project/multiforum-backend/pull/285)
made performance assumptions explicit:

- every session names `NEO4J_DATABASE`;
- definite session leaks were fixed;
- issue counters gained node-key constraints;
- custom list sizes default to 25 and reject values over 100;
- `pnpm run neo4j:audit` checks required constraints, online indexes, connector
  integrity, reply cycles/multiple parents, and duplicate counters;
- Neo4j GraphQL/OGM were patched to the secure compatible 5.12.15 release.

The audit found 51 invalid `DiscussionChannel` and 22 invalid `EventChannel`
nodes. [PR #286](https://github.com/gennit-project/multiforum-backend/pull/286)
added a dry-run-first repair/quarantine migration and protected future delete
workflows. [PR #287](https://github.com/gennit-project/multiforum-backend/pull/287)
made connector identity fields immutable and completed the production cleanup.

### Plain-language explanation

Indexes and optimized queries assume the graph follows certain rules. A schema
audit is the database equivalent of checking that every library book has one
catalog record and is shelved in exactly one valid place. Performance work is
not trustworthy if malformed data silently violates those assumptions.

## Phase 5: purpose-built detail and comment reads

### Discussion and download details

[PR #288](https://github.com/gennit-project/multiforum-backend/pull/288)
replaced broad generated hydration with three focused reads:

1. bounded discussion core data;
2. the one requested channel connector;
3. bounded downloadable-file data.

It replaced complete voter lists with aggregate counts and the current viewer's
vote records. On the backed-up Aura database, the three statements used 205
database hits in total in the recorded profile.

[PR #304](https://github.com/gennit-project/multiforum-backend/pull/304)
later tightened the initial collections to 5 answers, 12 images, and 12 files,
then added stable cursor queries for the remainder.

### Comments, replies, and events

- [PR #290](https://github.com/gennit-project/multiforum-backend/pull/290)
  selected the root-comment page before expanding authors, votes, child counts,
  versions, favorites, and subscriptions. The representative root query fell
  from 1,238 to 555 database hits (55% fewer).
- [PR #291](https://github.com/gennit-project/multiforum-backend/pull/291)
  applied the same pattern to replies and event comments. Representative
  profiles showed 27% fewer hits for replies and 52% fewer for event comments.

### Plain-language explanation

The old detail/comment path asked Neo4j to pack an entire moving truck, then
opened one box. The new path first chooses which boxes belong on the requested
page, then packs only those boxes and their labels.

## Phase 6: split other high-fanout feeds

[PR #294](https://github.com/gennit-project/multiforum-backend/pull/294)
split the site-wide discussion feed into count, page selection, and page-only
hydration. Votes, comments, flairs, tags, albums, and files are isolated in
scoped subqueries.

For the documented warm hot-feed sample:

| Metric        |   Before |  After | Change |
| ------------- | -------: | -----: | -----: |
| Database hits |    7,742 |  4,104 |   -47% |
| Operator rows |    3,416 |  2,393 |   -30% |
| Wall time     | 1,210 ms | 786 ms |   -35% |

[PR #296](https://github.com/gennit-project/multiforum-backend/pull/296)
removed seven production-only diagnostic calls from channel contributions and
isolated activity types in scoped subqueries. The resolver went from nine
database requests to two; representative user/moderator queries used 14% and
18% fewer database hits.

## Phase 7: bound GraphQL-generated work

[PR #297](https://github.com/gennit-project/multiforum-backend/pull/297)
added Neo4j GraphQL list limits and operation complexity rejection.
[PR #301](https://github.com/gennit-project/multiforum-backend/pull/301)
then calibrated the model against real frontend operations after an overly
conservative first estimate rejected legitimate traffic.

The current approach:

- defaults high-cardinality generated lists to 25;
- caps them at 100;
- scores the complete operation using supplied variables;
- rejects over-budget operations before resolver/Cypher execution;
- logs the operation name and score.

### Lesson learned

A safety limit must be tested against the application's real deepest query, not
only synthetic attack cases. “Strict” is not the same as “safe” if it takes the
application offline.

## Phase 8: indexed search

[PR #298](https://github.com/gennit-project/multiforum-backend/pull/298)
replaced case-insensitive leading-wildcard regular expressions with full-text
indexes for discussions, issues, and wiki pages.

On a disposable 10,000-discussion fixture with 100 matches:

| Search                     |                          Database hits |      Warm time |
| -------------------------- | -------------------------------------: | -------------: |
| Regex scan                 |                                 29,901 | about 130.6 ms |
| Full-text candidate lookup | 0 reported outside the index procedure |  about 13.9 ms |

The behavior is now token/prefix based rather than arbitrary substring regex
matching. User text is escaped before becoming a Lucene query.

### Plain-language explanation

The old search read every book to see whether it contained a phrase. The new
search consults a catalog that points directly to likely books, then applies
the ordinary access rules to that smaller set.

## Phase 9: cursor pagination

[PR #303](https://github.com/gennit-project/multiforum-backend/pull/303)
added cursor pagination to the site-wide discussion feed while retaining offset
compatibility. Hot ranking pins its timestamp for the pagination sequence, and
all modes include deterministic tie-breakers.

[PR #304](https://github.com/gennit-project/multiforum-backend/pull/304)
added opaque cursors for detail answers, files, and images. Integration tests
use equal timestamps to prove that page boundaries create neither gaps nor
duplicates.

### Offset versus cursor, in plain terms

If a filing cabinet contains 10,000 cards, page 100 with offset pagination says
“count past 9,900 cards, then hand me 100.” A cursor says “start immediately
after this exact card.” The latter stays approximately page-sized even deep in
the list.

## The patterns that mattered most

| Pattern             | Old behavior                        | Improved behavior                        |
| ------------------- | ----------------------------------- | ---------------------------------------- |
| Indexed anchor      | Check many nodes for a property     | Jump to matching nodes                   |
| Select then hydrate | Expand all matches, then page       | Page IDs, then expand those IDs          |
| Scoped subqueries   | Independent lists multiply rows     | Each list collapses before the next      |
| Narrow projections  | Return complete nodes/relationships | Return fields the UI uses                |
| Counts/viewer state | Load every voter/subscriber         | Count plus current viewer boolean/record |
| Stored predicate    | Re-traverse graph for every read    | Maintain once, read a property           |
| Full-text search    | Regex scan every body               | Index produces candidates                |
| Cursor pagination   | Walk past earlier pages             | Resume from a stable key                 |
| Focused statements  | One enormous generated plan         | A few bounded plans in one transaction   |

## What this history does not prove

These changes materially improve query shape, but they do not by themselves
prove that every main route meets the product goal. The cross-repository target
is p95 under two seconds for discussion/download lists and detail pages, tracked
in [frontend issue #597](https://github.com/gennit-project/multiforum-nuxt/issues/597).

The current database is small and the historical measurements used different
fixtures and conditions. The missing common performance fixture and query
budgets are tracked in
[backend issue #311](https://github.com/gennit-project/multiforum-backend/issues/311).
