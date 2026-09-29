# Neo4j Query Performance Guide

Use this guide when adding, reviewing, or diagnosing Neo4j-backed behavior in
Multiforum. It is written for Neo4j 5 and the versions currently pinned in this
repository. It is not a generic Cypher 25 guide.

## Before changing code

Answer four questions:

1. Which user-visible operation is slow?
2. Which layer owns the time: browser/proxy, GraphQL, authorization/resolver
   CPU, database calls, or request queuing?
3. Is the problem planning, execution, too many round trips, or response size?
4. Does cost grow with the requested page or with the entire graph?

Do not start by adding an index or rewriting Cypher merely because it looks
complex. Collect a baseline and preserve a result-equivalence fixture.

## Step 1: use request timing

Inspect the GraphQL response's `Server-Timing` header or the structured
`⏱️ GraphQL timing` log emitted by
[`services/requestTiming.ts`](../services/requestTiming.ts).

| Signal                                  | Likely interpretation                              |
| --------------------------------------- | -------------------------------------------------- |
| High `queue` and event-loop delay       | Node.js is CPU-bound or blocked                    |
| High `parse`/`validate`                 | Very large operation or schema/validation overhead |
| `execute` much larger than summed `db`  | Resolver, middleware, or authorization CPU         |
| High `db`                               | One or more slow Neo4j calls                       |
| High `dbCalls`                          | Sequential N+1-style round trips                   |
| Small backend total, slow browser route | Frontend/proxy/network/rendering issue             |

Summed database time can exceed wall time if calls overlap. It is attribution,
not a second stopwatch for the whole request.

## Step 2: isolate the actual statement

Determine whether the operation uses:

- Neo4j GraphQL-generated Cypher;
- an OGM selection set;
- a custom resolver and `.cypher` file;
- several queries in one transaction;
- permission rules or middleware that perform extra reads.

Generated query size and planning time can be the bottleneck even when the
database execution itself returns quickly. Capture the actual generated
statement when investigating that path; do not infer it from the GraphQL
document alone.

## Step 3: inspect schema before proposing an index

Run read-only schema checks against the same database/version used for the
profile:

```cypher
SHOW CONSTRAINTS YIELD name, type, labelsOrTypes, properties
RETURN name, type, labelsOrTypes, properties;

SHOW INDEXES YIELD name, type, labelsOrTypes, properties, state
RETURN name, type, labelsOrTypes, properties, state;
```

The repository's broader repeatable check is:

```bash
pnpm run neo4j:audit
```

It verifies required constraints/indexes and graph invariants. An index must be
`ONLINE` before a query can rely on it.

### Composite-index reminder

An index on `(discussionId, channelUniqueName)` is not equivalent to one on
`channelUniqueName`. Composite index order matters. Propose indexes from the
actual predicates and verify their use with a plan.

## Step 4: use `EXPLAIN` before `PROFILE`

`EXPLAIN` compiles without executing. Use it first for syntax and plan shape,
especially against Aura.

`PROFILE` executes and reports actual rows/database hits. For safe read queries,
run it twice: the first pass warms caches and the second is the more useful warm
comparison. Never `PROFILE` a production write.

Read a plan from the bottom up. The leaf operator shows how Neo4j found the
starting data.

### Important plan signals

| Operator/metric                     | Meaning                                     | Usual response                                |
| ----------------------------------- | ------------------------------------------- | --------------------------------------------- |
| `NodeUniqueIndexSeek`               | Exact constrained lookup                    | Good anchor                                   |
| `NodeIndexSeek`                     | Indexed lookup/range                        | Usually good                                  |
| `NodeByLabelScan`                   | Reads every node with a label               | Check selectivity/index; sometimes legitimate |
| `AllNodesScan`                      | Reads every node in the database            | Almost always fix the anchor/label            |
| `CartesianProduct`                  | Independent row streams multiplied          | Connect patterns or isolate them              |
| `Eager`                             | Materializes all rows                       | Investigate read/write overlap or query shape |
| `Top`                               | Sort plus bounded limit                     | Preferable to full sort where possible        |
| `Sort` before late `LIMIT`          | Sorts the full candidate set                | Push the page boundary earlier                |
| High rows then low final rows       | Too much intermediate work                  | Reduce cardinality earlier                    |
| High database hits per returned row | Repeated traversal/scanning                 | Anchor, isolate, or narrow projection         |
| Estimates far from actual rows      | Planner lacks useful statistics/selectivity | Check statistics/indexes/query shape          |

A `NodeByLabelScan` is not automatically wrong on a tiny or intentionally
complete set. The question is whether its work grows acceptably and whether a
selective predicate should have used an index.

## Step 5: test cardinality, not just elapsed time

Wall time on a remote database includes network and transient load. Record:

- database hits;
- maximum/intermediate operator rows;
- returned rows;
- page-cache hits/misses where available;
- planning versus execution timing where available;
- database call count;
- warm and cold wall time;
- exact returned IDs/order for equivalence.

Database hits and intermediate rows often provide a more stable explanation of
why a query will or will not scale.

## Project patterns to prefer

### Indexed, labeled anchors

```cypher
// Good: label + constrained/indexed property.
MATCH (discussion:Discussion {id: $discussionId})
RETURN discussion.id AS id
```

Avoid a property-only unlabeled anchor; it cannot use a label/property index:

```cypher
MATCH (discussion {id: $discussionId})
RETURN discussion.id AS id
```

### Select IDs before hydration

The preferred list architecture is:

```text
cheap count -> cheap ordered page of IDs -> hydrate those IDs only
```

See
[`buildSiteWideDiscussionPageQueries.ts`](../customResolvers/cypher/buildSiteWideDiscussionPageQueries.ts)
and [`getSiteWideDiscussionsQuery.cypher`](../customResolvers/cypher/getSiteWideDiscussionsQuery.cypher).

Keep the statements in one managed leader transaction when they need one
consistent snapshot.

### Collapse one-to-many branches independently

Do not chain unrelated growing `OPTIONAL MATCH` branches and repair the result
with `collect(DISTINCT ...)`. Put each branch in a scoped `CALL { ... }`
subquery that returns one row per parent before the next branch begins.

### Limit before expensive work

Apply `ORDER BY`/`LIMIT` to the cheap candidate rows before matching authors,
votes, histories, children, images, files, and roles.

### Return a narrow map

Return the properties required by the GraphQL document, not whole nodes and not
`RETURN *`. This reduces database work, driver conversion, and response size,
and makes the resolver contract reviewable.

### Use aggregate/viewer-specific reads

For a vote widget, fetch total count plus the current viewer's edge. Do not
hydrate every voter. Ensure the authorization contract does not accidentally
make a private relationship public when introducing an aggregate field.

### Use stable cursor keys

A cursor order needs a unique final tie-breaker:

```cypher
ORDER BY discussion.createdAt DESC, discussion.id DESC
```

The continuation predicate must mirror the same directions. Hot/ranked paging
must pin time-dependent inputs such as the ranking timestamp for the complete
sequence.

### Use fixed query shapes

User values must remain `$parameters`. It is acceptable for trusted server code
to choose among fixed Cypher fragments for active filters/sort modes. Do not
interpolate user content into query text.

### Use full-text indexes for free text

Do not reintroduce leading-wildcard regular expressions over titles/bodies.
Build a safe full-text query and let the index produce candidates, then apply
visibility and domain filters.

## Driver and transaction rules

- The application creates one shared driver.
- [`services/neo4jDatabase.ts`](../services/neo4jDatabase.ts) ensures every
  session names `NEO4J_DATABASE`.
- Close explicit sessions with `await session.close()` in `finally`.
- Keep current reads leader-routed unless bookmark propagation is implemented.
- Prefer managed transactions for retry-safe units, but remember that the
  callback can run more than once.
- Consume/map results inside the managed transaction callback.
- Do not perform email, HTTP, storage, logging with external consequences, or
  other irreversible side effects inside a retryable callback.
- Batch repeated writes with `UNWIND` rather than one round trip per item when
  transaction semantics allow it.

The managed-write migration is tracked in
[issue #310](https://github.com/gennit-project/multiforum-backend/issues/310),
and bookmark propagation in
[issue #305](https://github.com/gennit-project/multiforum-backend/issues/305).

## Neo4j GraphQL rules

- The repository is on Neo4j GraphQL v5. Use v5 schema/filter/options syntax.
- Generated resolvers are appropriate for ordinary bounded CRUD.
- Prefer a purpose-built resolver when a hot operation creates a huge generated
  statement, row multiplication, or an unclear/unbounded cost.
- OGM calls bypass GraphQL authorization. Enforce authorization explicitly.
- New output fields and resolver types must be added to the default-deny
  graphql-shield permission map.
- High-cardinality types need `@limit`; custom resolvers must call the shared
  pagination normalization.
- Exercise real frontend operations against the complexity model. Do not raise
  the global ceiling merely to hide a badly shaped operation.

## Correctness and security checks

Performance changes must preserve:

- channel membership and route identity;
- signed-out and signed-in authorization;
- sensitive/age-gated visibility;
- archived/permanently removed filtering;
- exact sort order and aggregate counts;
- current-viewer vote/subscription/favorite state;
- equal-timestamp/equal-score pagination boundaries;
- read-your-own-writes behavior.

An optimized query that returns data the viewer must not see is not an
optimization.

## Testing expectations

At minimum:

1. Unit-test query selection, parameters, limits, session cleanup, and error
   behavior.
2. Add a Testcontainers integration fixture that executes the real Cypher.
3. Cover empty and populated pages.
4. Cover equal sort keys and multiple cursor pages.
5. Compare returned IDs/order/fields with the prior implementation or contract.
6. Run `EXPLAIN` against the target Neo4j version.
7. For a hot query, record before/after `PROFILE` evidence twice.
8. Run the full build/type/lint/test checks required by the repository.

Do not assert the exact complete planner tree: Neo4j patch versions may make
valid planning changes. Assert durable properties such as bounded rows,
database-hit budgets, indexed anchors, and the absence of unintended scans,
Cartesian products, or eager materialization. The large-fixture implementation
is tracked in
[issue #311](https://github.com/gennit-project/multiforum-backend/issues/311).

## Review checklist

- [ ] User-visible operation and baseline are identified.
- [ ] Schema, constraints, and online indexes were inspected.
- [ ] Query starts from a labeled selective anchor.
- [ ] Page boundary occurs before high-fanout hydration.
- [ ] Independent growing relationships cannot multiply one another.
- [ ] Public list/collection sizes are bounded.
- [ ] Ordering is deterministic and cursor predicate mirrors it.
- [ ] Projection contains only required fields.
- [ ] Parameters are used for all user values.
- [ ] Session targets the configured database and closes in `finally`.
- [ ] Managed transaction callback is retry-safe.
- [ ] Authorization and sensitive-content behavior are tested.
- [ ] Result IDs/order are equivalent to the intended behavior.
- [ ] `EXPLAIN` contains no unexplained red flags.
- [ ] `PROFILE` evidence and database-call count are recorded for hot paths.
- [ ] The PR explains the change in plain language.

## Useful commands

```bash
pnpm run codegen
pnpm run tsc
pnpm test
pnpm run test:integration
pnpm run neo4j:audit
pnpm run build
```

Use a database that is safe for the operation. `EXPLAIN` is read-only;
`PROFILE` executes the statement. Production profiling must stay read-only and
requires explicit authorization and a current backup where appropriate.
