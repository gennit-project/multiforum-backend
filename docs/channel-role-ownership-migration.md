# Channel role ownership migration

Every `ChannelRole` and `ModChannelRole` is owned by exactly one `Channel`
through `OWNS_CHANNEL_ROLE` or `OWNS_MOD_CHANNEL_ROLE`. The stored
`channelUniqueName` and `name` remain immutable identity keys so each channel
can use familiar role names independently.

Run the audit before deploying the schema change:

```sh
pnpm migrate:channel-role-ownership
```

The dry run reports:

- roles attached as defaults to more than one channel;
- scalar channel keys that do not resolve to a channel;
- existing ownership relationships that are duplicated or disagree with
  default-role attachments (missing owner relationships are the expected
  backfill case);
- scalar/attachment identity mismatches;
- missing role names or channel identities;
- duplicate role names within one channel; and
- legacy global role-name constraints that the apply step will remove.

For a role referenced by one channel default/elevated/suspended relationship,
that relationship is authoritative. An unattached role can be backfilled from
its scalar channel key only when the key resolves to exactly one channel. Fix
every reported ambiguity or duplicate before applying:

```sh
pnpm migrate:channel-role-ownership -- --apply
```

The apply step transactionally assigns missing IDs, synchronizes the immutable
channel key, and merges the owner relationship. Only after that succeeds does
it remove the old global uniqueness constraints on `name`. It is idempotent
and refuses unsafe data.

Re-run the dry run and `pnpm neo4j:audit`, then deploy. Startup creates
`channel_role_channel_name_unique` and
`mod_channel_role_channel_name_unique`; Enterprise uses node keys while
Community uses composite uniqueness constraints.
