# Neo4j identity invariants

Some values are identifiers, not ordinary editable content:

- `Channel.uniqueName` is part of public URLs and is copied into other nodes.
- A `DiscussionChannel` is identified by its `discussionId`,
  `channelUniqueName`, `Discussion`, and `Channel` endpoints.
- An `EventChannel` has the equivalent event and channel identity fields.

The generated GraphQL API permits these values when a node is created but
omits them from update inputs. It also treats connector and channel
`createdAt` timestamps as server-owned. Reconnecting content uses the custom
mutation paths, which create or reconnect the appropriate connector rather
than rewriting an existing connector's identity.

A future channel rename must be implemented as an explicit database migration.
It must update the `Channel.uniqueName` and every denormalized reference in one
transaction, then run `pnpm run neo4j:audit`. Adding `uniqueName` back to the
generic channel update input is not a safe rename implementation.
