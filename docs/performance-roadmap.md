# Backend Performance Status and Roadmap

This is the current source of truth for backend performance work. It supersedes
the July 2026 static-audit backlog that originally occupied this file.

Newcomers should begin with
[Neo4j performance: newcomer overview](./neo4j-performance-overview.md). The
[performance history](./neo4j-performance-history.md) explains the completed
work and measurements, and the
[query performance guide](./neo4j-query-performance-guide.md) is the practical
runbook for future changes.

Last reconciled: **September 2026**, after backend PR #304.

## Product goal

The cross-repository objective is:

> Discussion lists, download lists, discussion details, and download details
> should each reach useful initial content in under two seconds at p95.

Frontend [issue #597](https://github.com/gennit-project/multiforum-nuxt/issues/597)
defines the route-ready boundary, cold/direct versus in-app measurements, and
the requirement to measure every route category separately.

The backend's working target for normal cached reads is approximately p95 under
500 ms and p99 under one second, leaving time for the network, frontend proxy,
browser, and rendering. That is a planning target, not yet a demonstrated
service-level guarantee.

## Current state

The backend is substantially safer and more predictable than at the start of
the performance investigation:

- request and database timing are visible per GraphQL operation;
- key identity lookups and full-text searches are indexed;
- public generated lists have default/hard limits and operation complexity
  protection;
- channel and site-wide discussion feeds select a page separately from heavy
  hydration;
- root comments, replies, event comments, contributions, and detail pages use
  bounded purpose-built reads;
- the main site-wide discussion feed and detail collections support stable
  cursor pagination;
- schema and graph invariants have a repeatable read-only audit;
- malformed legacy connector nodes were repaired or quarantined, and lifecycle
  protections prevent recurrence;
- sessions name the target database and known session leaks were fixed;
- sensitive-content authorization usually reads stored flags instead of
  rebuilding graph traversals.

This does **not** mean performance work is finished. The current production
graph is small, historical benchmarks used different scenarios, and the four
primary route categories do not yet have one shared p95 measurement system and
large representative fixture.

## Completed work map

| Area                         | PRs                                                                                                                                                                                                                                                                                                                                                                                                                                      | Outcome                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Timing and diagnosis         | [#264](https://github.com/gennit-project/multiforum-backend/pull/264)                                                                                                                                                                                                                                                                                                                                                                    | GraphQL phase, Neo4j, call-count, and event-loop timing                        |
| Identity/index foundations   | [#266](https://github.com/gennit-project/multiforum-backend/pull/266), [#269](https://github.com/gennit-project/multiforum-backend/pull/269), [#282](https://github.com/gennit-project/multiforum-backend/pull/282), [#285](https://github.com/gennit-project/multiforum-backend/pull/285)                                                                                                                                               | Indexed lookup keys, database/session defaults, audit contract                 |
| Age-gate read cost           | [#267](https://github.com/gennit-project/multiforum-backend/pull/267), [#270](https://github.com/gennit-project/multiforum-backend/pull/270), [#272](https://github.com/gennit-project/multiforum-backend/pull/272), [#274](https://github.com/gennit-project/multiforum-backend/pull/274), [#278](https://github.com/gennit-project/multiforum-backend/pull/278), [#279](https://github.com/gennit-project/multiforum-backend/pull/279) | Cached policy and materialized visibility flags with write-time reconciliation |
| Channel list                 | [#281](https://github.com/gennit-project/multiforum-backend/pull/281)–[#283](https://github.com/gennit-project/multiforum-backend/pull/283)                                                                                                                                                                                                                                                                                              | Page selection before hydration; fixed active query shapes                     |
| Graph integrity              | [#286](https://github.com/gennit-project/multiforum-backend/pull/286), [#287](https://github.com/gennit-project/multiforum-backend/pull/287)                                                                                                                                                                                                                                                                                             | Repair/quarantine migration, deletion guards, immutable identity               |
| Detail reads                 | [#288](https://github.com/gennit-project/multiforum-backend/pull/288), [#304](https://github.com/gennit-project/multiforum-backend/pull/304)                                                                                                                                                                                                                                                                                             | Focused reads and cursor-paged answers/images/files                            |
| Comments and replies         | [#290](https://github.com/gennit-project/multiforum-backend/pull/290), [#291](https://github.com/gennit-project/multiforum-backend/pull/291)                                                                                                                                                                                                                                                                                             | Page before author/vote/version/child hydration                                |
| Site-wide/contribution feeds | [#294](https://github.com/gennit-project/multiforum-backend/pull/294), [#296](https://github.com/gennit-project/multiforum-backend/pull/296)                                                                                                                                                                                                                                                                                             | Scoped subqueries, fewer rows/hits/calls                                       |
| API cost controls            | [#297](https://github.com/gennit-project/multiforum-backend/pull/297), [#301](https://github.com/gennit-project/multiforum-backend/pull/301)                                                                                                                                                                                                                                                                                             | List limits and calibrated operation complexity                                |
| Indexed content search       | [#298](https://github.com/gennit-project/multiforum-backend/pull/298)                                                                                                                                                                                                                                                                                                                                                                    | Full-text candidate lookup replaces regex label scans                          |
| Primary-feed cursors         | [#303](https://github.com/gennit-project/multiforum-backend/pull/303)                                                                                                                                                                                                                                                                                                                                                                    | Stable new/top/hot keyset pagination                                           |

Detailed before/after evidence is in
[neo4j-performance-history.md](./neo4j-performance-history.md).

## Open work: performance and safe scaling

### Establish shared fixtures and budgets

[Backend issue #311](https://github.com/gennit-project/multiforum-backend/issues/311)
is the most important measurement follow-up. It will add thousands of
discussions/downloads and tens of thousands of comments/votes/media, then set
durable budgets for database hits, intermediate rows, and forbidden plan
operators.

Until this exists, a query can regress in scaling behavior while remaining fast
on today's small graph.

### Finish materialized age-gate reads

[Issue #308](https://github.com/gennit-project/multiforum-backend/issues/308)
tracks `publicCollectionsContaining`, which still invokes computed
`ageGateSensitive` traversals instead of the stored flag.

### Bookmark propagation before reader routing

[Issue #305](https://github.com/gennit-project/multiforum-backend/issues/305)
tracks causal bookmarks. Reads remain leader-routed until immediate post-write
reads can safely observe their own write on a routed cluster.

Do not independently change a hot read to `READ` routing as a local performance
shortcut.

### Review remaining collect-before-page paths

Some non-primary or less mature reads still collect or compute the complete
matching set before slicing, including areas called out by the earlier roadmap
such as administrative health/channel views. Profile these against a large
fixture and convert them to select-then-hydrate only when measurement shows user
impact.

The forum-scoped discussion selection query also returns an aggregate count and
therefore collects ordered matching IDs before slicing. The heavy relationship
hydration is already page-bounded, which fixed the acute latency, but this
selection/count strategy should be re-evaluated at large channel sizes.

### Make date predicates and indexes match

Several legacy predicates wrap stored `DateTime` values in `datetime(...)`.
That can prevent direct range-index use, and some feeds filter connector
timestamps rather than parent content timestamps. Treat this as query-specific
work: profile the actual predicate, add the index on the property actually
filtered, and verify `NodeIndexSeek`/range behavior rather than adding broad
speculative indexes.

### Batch repeated write loops

Several workflows can issue one query per item (event occurrences/channels,
plugin refresh, mention-related work). Where atomicity and side effects allow,
use `UNWIND` or another bounded batch to reduce round trips. Measure first and
keep retry behavior explicit.

### Move expired-suspension cleanup off authorization reads

Permission checks still identify expired suspensions and trigger disconnect
writes from the authorization path. Request-scoped caching limits repeated
lookups, but a read/permission decision should ideally not initiate cleanup
writes. Move expiration cleanup to a bounded background process if measurement
or transaction hardening work reaches this area.

### Tune the connection pool from deployment evidence

The driver now validates connections that have been idle for 30 seconds, which
fixed the stale-connection first-request penalty. Other pool settings remain
mostly at driver defaults. Do not guess new limits: use Aura capacity,
concurrency, acquisition-wait timing, and failure behavior to set pool size and
timeouts. Under load, a long acquisition timeout can turn saturation into very
slow requests rather than a fast, observable failure.

## Open work: correctness and hardening that protects performance

| Issue                                                                                                            | Why it matters                                                                        |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [#306](https://github.com/gennit-project/multiforum-backend/issues/306) — critical property existence/types      | Missing or wrong-typed identity/cursor properties undermine indexes and stable paging |
| [#307](https://github.com/gennit-project/multiforum-backend/issues/307) — bound reply ancestry and reject cycles | Unbounded traversals and malformed threads can grow unpredictably                     |
| [#309](https://github.com/gennit-project/multiforum-backend/issues/309) — request/logging envelope               | A 50 MB JSON limit and full payload logging waste memory and expose sensitive values  |
| [#310](https://github.com/gennit-project/multiforum-backend/issues/310) — managed write transactions             | Retry-safe atomic writes prevent partial graph state under transient failures         |
| [#284](https://github.com/gennit-project/multiforum-backend/issues/284) — GraphQL 7 / driver 6 migration         | Removes the discontinued OGM constraint and enables the supported modern stack        |

## Frontend work that affects the same goal

Backend latency is only part of route time. Related frontend issues include:

- [#546](https://github.com/gennit-project/multiforum-nuxt/issues/546) — route
  budgets and production Web Vitals;
- [#548](https://github.com/gennit-project/multiforum-nuxt/issues/548) — safe
  anonymous edge caching;
- [#549](https://github.com/gennit-project/multiforum-nuxt/issues/549) — shared
  detail-route preload graph;
- [#551](https://github.com/gennit-project/multiforum-nuxt/issues/551) — defer
  the optional 3D viewer;
- [#552](https://github.com/gennit-project/multiforum-nuxt/issues/552) — detail
  GraphQL latency;
- [#597](https://github.com/gennit-project/multiforum-nuxt/issues/597) — the
  overarching two-second route goal.

## Prioritization rule

Prioritize work where these three signals overlap:

1. a user-visible route or operation is measurably slow;
2. timing identifies the responsible layer/query;
3. the plan or call graph explains how cost grows.

Schema/integrity and security hardening may still be worth doing without a
current latency symptom, because they prevent data corruption or resource
exposure. Pure performance changes should be measured before and after.

## Definition of done for a hot-query improvement

- Same intended records, fields, counts, and order.
- Same authorization and sensitive-content behavior.
- Public page size is bounded.
- Cost scales approximately with page size, not total graph size.
- No unexplained `AllNodesScan`, label scan, Cartesian product, or `Eager`.
- Indexed lookup properties have online indexes/constraints.
- Equal sort keys do not break pagination.
- Session/transaction lifecycle is correct and retry-safe.
- Unit and real-Neo4j integration regression coverage exists.
- Before/after plan evidence and database call count are recorded.
- The PR includes a plain-language explanation of why the new shape does less
  work.

Use the [query performance guide](./neo4j-query-performance-guide.md) as the
implementation checklist.
