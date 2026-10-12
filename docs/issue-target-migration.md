# Issue target relationship migration

`Issue` keeps immutable scalar target identifiers as durable moderation
snapshots and uniqueness keys. When the target still exists, it also has a
typed `TARGETS_*` relationship for live traversal.

Run the audit before deploying the schema change:

```sh
pnpm migrate:issue-targets
```

The dry run reports relationships that can be backfilled, scalar snapshots
whose target has already been deleted, mismatched or duplicate relationships,
and ambiguous target keys. A missing target is informational: its scalar
snapshot remains valid and is not removed.

Resolve every mismatched, duplicate, or ambiguous relationship before applying:

```sh
pnpm migrate:issue-targets -- --apply
```

The apply step is transactional and idempotent. It creates only relationships
whose scalar target resolves to exactly one live node. Re-run the dry run and
`pnpm neo4j:audit` afterward.
