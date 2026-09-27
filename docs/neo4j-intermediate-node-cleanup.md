# Neo4j intermediate-node cleanup

`DiscussionChannel` and `EventChannel` are connector nodes: each active node
must point to exactly one content node and exactly one `Channel`. Older parent
deletes removed the `Discussion` or `Event` but left the connector behind.

The cleanup is deliberately non-destructive:

- A missing endpoint is repaired only when its stored `discussionId`,
  `eventId`, or `channelUniqueName` identifies exactly one existing node.
- Anything that cannot be repaired unambiguously loses its active connector
  label and gains `QuarantinedDiscussionChannel` or
  `QuarantinedEventChannel`.
- Quarantined nodes keep all properties and relationships, including comments,
  votes, label choices, and issue links.
- New parent deletes run the same quarantine guard, so they no longer leave
  malformed nodes in the active graph.

## Runbook

The command is a read-only dry run unless `--apply` is present:

```sh
pnpm run neo4j:cleanup-intermediate-nodes
```

Review `repairable` and `toQuarantine`, confirm a current backup exists, then
apply:

```sh
pnpm run neo4j:cleanup-intermediate-nodes -- --apply
```

The apply operation runs in one managed transaction and is idempotent. A
successful report has zero values under `remainingInvalid`. Finish by running:

```sh
pnpm run neo4j:audit
```

The first production dry run found 51 invalid discussion connectors (6
repairable, 45 to quarantine) and 22 invalid event connectors (2 repairable,
20 to quarantine). No production writes were made during that dry run.
