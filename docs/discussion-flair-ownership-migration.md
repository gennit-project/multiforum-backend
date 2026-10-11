# Discussion flair ownership migration

`DiscussionFlair` ownership is represented by exactly one incoming
`(:Channel)-[:HAS_DISCUSSION_FLAIR]->(:DiscussionFlair)` relationship. The
legacy `DiscussionFlair.channelUniqueName` property duplicated that relationship
and could drift from it. API responses continue to expose `channelUniqueName`,
but derive it from the owner relationship.

Before deploying the schema change, run the migration in dry-run mode:

```sh
pnpm run migrate:discussion-flair-ownership
```

The report identifies:

- orphaned flairs with no owning channel;
- multiply-owned flairs with more than one owning channel;
- stored channel names that disagree with relationship ownership; and
- the number of legacy properties that remain.

Repair or quarantine orphaned and multiply-owned records before applying the
migration. A mismatched scalar does not block migration because the relationship
is authoritative and removing the scalar resolves the drift.

After resolving structural problems, remove the legacy property:

```sh
pnpm run migrate:discussion-flair-ownership -- --apply
pnpm run neo4j:audit
```

The apply step is transactional and refuses to remove any property while an
orphaned or multiply-owned flair exists. It is safe to rerun: once the properties
are absent, the update count is zero.
