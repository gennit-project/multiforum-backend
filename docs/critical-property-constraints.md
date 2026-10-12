# Critical Neo4j property constraints

Issue #306 adds an incremental Enterprise/Aura boundary for properties whose
absence or wrong type can break identity lookup, routing, `MERGE`, or stable
pagination.

## Use cases and chosen properties

The constrained properties support these primary query paths:

1. Resolve users, channels, content, files, images, and versions by immutable
   identity.
2. `MERGE` discussion/event channel connectors by their routing snapshots.
3. Allocate channel and server issue numbers through counter identities and
   integer values.
4. Seek discussion, comment, connector, image, file, and version cursor pages
   using `createdAt` plus an immutable ID tie-breaker.
5. Open issue, event, and wiki detail/history views with a typed ID and ordering
   timestamp.

The source of truth is `criticalPropertyDefinitions` in
`services/criticalPropertyConstraints.ts`. Every selected property receives an
`IS NOT NULL` constraint and an `IS :: <TYPE>` constraint. The first slice
covers:

- identity/routing strings on `User`, `Channel`, `Discussion`, `Comment`,
  `Event`, `WikiPage`, `Issue`, `DiscussionChannel`, `EventChannel`, `Image`,
  `DownloadableFile`, `TextVersion`, and both issue counter labels;
- integer `Issue.issueNumber` and issue-counter `current` values;
- zoned `createdAt` values used by list/detail ordering for discussions,
  comments, events, wiki pages, issues, connectors, images, downloads, and text
  versions.

Optional business fields and timestamps that are not ordering keys remain
outside this first enforcement slice.

## Deployment procedure

Run the audit before deploying code that provisions the constraints:

```sh
pnpm migrate:critical-properties
```

The dry run reports two classes of violation:

- `blockingViolations`: missing identity/cursor data or any wrong type. The
  migration refuses to guess or coerce these records; repair or quarantine them
  explicitly and rerun the audit.
- `repairableViolations`: legacy `Image.createdAt` omissions. The October 2026
  Aura audit found six such records with no recoverable upload timestamp. Apply
  assigns the deterministic Unix epoch and records
  `createdAtBackfillSource = "legacy-unknown"`, preserving stable `(createdAt,
  id)` ordering without inventing relative chronology.

Apply only after reviewing the dry run:

```sh
pnpm migrate:critical-properties -- --apply
pnpm neo4j:audit
```

The apply path repairs only the documented legacy image case, reruns the data
audit, creates every constraint with `IF NOT EXISTS`, and verifies every name is
visible through `SHOW CONSTRAINTS`. Property existence/type constraints do not
own backing indexes, so there is no index population state to wait for.

Community Edition is deliberately skipped. Production startup provisions and
verifies these constraints only when `dbms.components()` reports Enterprise
(including Aura).
