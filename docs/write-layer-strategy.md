# Write-layer strategy: generated reads, owned writes

## The principle

> Use the `@neo4j/graphql` generated API for **reads and simple writes**. Own
> **complex, critical, or relationship-heavy writes** as explicit Cypher in the
> driver-backed repositories under [`services/persistence/`](../services/persistence).

This is the deliberate boundary the codebase draws around the Neo4j GraphQL
library. It is not a rejection of the library — its read side (filtering,
ordering, pagination, nested projection) is excellent and the frontend depends on
it. The boundary is specifically about **where our load-bearing write logic
lives**.

## Why

The library auto-generates two very different things, and they age very
differently:

- **Reads** are a stable, declarative win. Keep leaning on them.
- **Generated mutations** are a leaky abstraction for anything beyond a flat
  create/update. They encode our write semantics as deeply-nested input literals
  that only the library knows how to interpret, and the shapes they support
  change between major versions.

The `@neo4j/graphql` 7 upgrade made this concrete. v7 removed nested
`connect`/`disconnect` for **to-one (single) relationships** entirely — there is
no connect on the create input, none on the update input, and no top-level
`*ConnectInput` for the type. (Mechanically: v7 made `connect` always *add* a new
edge and removed `overwrite`; "add another edge" is a contradiction on a field
that may hold only one, so connect has nowhere to stand on a to-one field. See
issue #284.) Any write that created a record and linked it to an *existing*
single related node — which our moderation flows do constantly — no longer has a
generated form.

That is a dependency's design decision reaching directly into our moderation and
authorization-critical write paths. The durable response is to stop making those
paths depend on the generated mutation surface.

## What "owned writes" buys us

- **Insulation from library churn.** The generated mutation surface will change
  again at the next major version (and will again pull the frontend along).
  Writes we own in Cypher do not care what the mutation generator does.
- **Atomicity.** One Cypher statement fully happens or does not — no "node
  created but edge failed" half-states from a two-call "create then wire it up"
  seam.
- **A stable contract for the frontend.** Behind a custom resolver *we* define
  the mutation signature. When the library reshapes its generated mutations, an
  owned mutation looks identical to the client, shrinking exactly the kind of
  lockstep backend/frontend cutover the v7 migration otherwise forces.
- **The complexity lives in one readable, testable place** instead of an opaque
  nested input literal.

## Where the line falls

| Operation shape | Layer |
| --- | --- |
| Reads: queries, filtering, ordering, pagination, nested projection | Generated API (library) |
| Simple writes: flat create/update of one entity's own scalar fields, list-relationship connects | Generated API (via repositories) |
| Complex writes: multi-entity, nested, to-one relationship connect/disconnect, auth-sensitive, cross-entity workflows | **Owned Cypher** in `services/persistence/` repositories, behind custom resolvers |

A write belongs in the owned layer when any of these hold: it touches more than
one node type in one logical operation, it connects or disconnects an existing
node on a to-one relationship, its correctness is security-relevant (moderation,
suspension, ownership), or the generated mutation for it has become an
unreadable deeply-nested literal.

## How to build an owned write

1. Put the logic in a `services/persistence/*Repository.ts` method, not in the
   resolver. The resolver assembles a plain params object and calls it.
2. Express the whole operation as a **single parameterized Cypher statement** run
   through the driver (`driver.executeQuery` / an `executeWrite` transaction).
   Create the nodes and `MERGE` the edges in one statement so it is atomic.
3. For "link an existing node if present" (the to-one connect that v7 removed),
   use the established best-effort pattern already in the codebase
   (`permanentlyDeleteStoredUpload`):

   ```cypher
   OPTIONAL MATCH (actor:ModerationProfile { displayName: $modProfileName })
   FOREACH (_ IN CASE WHEN actor IS NULL THEN [] ELSE [1] END |
     MERGE (actor)-[:PERFORMED_MODERATION_ACTION]->(action)
   )
   ```

4. Keep leader routing (the driver default) — do not switch these to `READ`
   sessions; read-your-own-writes depends on it (see the Neo4j session-routing
   note in [architecture.md](architecture.md)).
5. Cover it with an integration test against real Neo4j — Cypher correctness is
   not checked by `tsc`, so the integration suite is the gate.

## Adoption

This is a direction, not a big-bang rewrite. The first deliberate instance is
`recordModerationAction` (the moderation-action/issue write), built during the v7
migration (issue #284, "Family 3"). Its structure — one repository method, one
atomic Cypher statement, best-effort to-one connects — is the template. Other
complex writes migrate to this pattern gradually, as they come up or cause
friction; simple writes and all reads stay on the generated API.

See also: [`managed-write-inventory.md`](managed-write-inventory.md) for the
current catalogue of writes that already run through managed/driver-backed paths.
