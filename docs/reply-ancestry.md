# Reply ancestry invariant

Comments may have at most one outgoing `IS_REPLY_TO` relationship to another
`Comment`. Root comments have depth 0, and replies may be nested through depth
32. A reply relationship must not create a self-cycle or an indirect cycle.

The depth limit is intentionally much larger than ordinary conversational
threads while keeping authorization, moderation, contribution, and age-gate
lookups predictably bounded. All production Cypher ancestry reads use the same
32-edge maximum. Validation inspects one additional edge so a legacy over-depth
chain is rejected rather than extended.

## Write paths

- GraphQL `createComments` validates every input before mutation execution.
- GraphQL `updateComments` permits reparenting only when both the comment and
  proposed parent are selected by unique IDs. An existing different parent must
  be disconnected or overwritten in the same update.
- Nested `ChildComments` writes and nested reply relationship writes are
  rejected. Clients create replies through the child's `ParentComment` field.
- Bot-authored replies call the same ancestry validator before using the OGM.

These application checks protect normal writes. Neo4j does not provide a
relationship-cardinality constraint for enforcing one parent at the database
schema level, so `neo4j:audit` remains the backstop for writes made outside the
application.

## Audit behavior

`pnpm run neo4j:audit` reports:

- comments with multiple reply parents;
- comments participating in a cycle of up to 33 edges; and
- comments whose ancestry reaches 33 edges.

A longer cycle necessarily also reaches the over-depth threshold, so every
malformed cycle is reported without an unbounded traversal.
