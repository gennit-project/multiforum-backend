# Public GraphQL schema contract

The backend owns the augmented public API. Phase 1 of the typing campaign exports
that API independently of server startup, environment secrets, and Neo4j. This
is a schema contract, not a promise that every resolver fulfills its response:
operation validation and typed custom responses are later campaign phases.

## Export and provenance

Use the Node version in `.nvmrc`, a clean checkout at the desired commit, and
`pnpm install --frozen-lockfile`. Then run:

```sh
pnpm schema:export
```

The ignored `artifacts/graphql-schema/` directory contains:

- `schema.graphql`: augmented public SDL, including deprecated input fields and
  the current runtime feature surface. Runtime startup, type generation, and export share the
  same feature settings.
- `manifest.json`: format version, canonical backend repository, full source
  commit, installed GraphQL/Neo4j dependency versions, lockfile SHA-256, and the
  schema's byte length and SHA-256.

The exporter rejects a dirty checkout, including untracked source files. It has
no timestamp or machine-specific paths in its output. The same clean commit
and frozen dependencies produce the same bytes. An optional output directory
is accepted: `pnpm schema:export /tmp/backend-schema` (use an ignored or external
output directory so a subsequent export remains clean).

The Tests CI workflow publishes `graphql-schema-<checkout SHA>` with 90-day
retention. A PR workflow exports GitHub's checked-out merge commit; the manifest
records that exact commit, not the PR head. Prefer a main-branch artifact for
normal frontend updates. Artifacts expire; the commit plus frozen lockfile is
the durable recipe for reproducing one.

## Update the frontend pin

1. Export the desired clean backend revision, or download and extract its
   `graphql-schema-<SHA>` artifact from a trusted successful backend CI run.
2. In the frontend checkout, run `pnpm schema:update /path/to/export-directory`.
3. Run `pnpm schema:check`, `pnpm compile`, and `pnpm tsc`.
4. Commit the frontend's `graphql-schema/` directory and any generated type
   changes together. Explain the backend revision and compatibility impact in
   the frontend PR.

Frontend CI reads its committed contract. It does not fetch mutable `main`,
require access to the private backend repo, introspect production, or use a
GraphQL endpoint secret. A schema update is a reviewed dependency change. It
establishes the version the frontend is checked against, not the version
currently deployed to every environment. Checksums detect corruption; they do
not authenticate an artifact from an untrusted source.

## Current coverage and next phases

The handwritten public definitions live in `typeDefs.ts`; Neo4j generates the
CRUD, filter, connection, and subscription surface. Custom resolver registration
is in `customResolvers.ts`; custom Cypher projections and driver repositories
supply data whose completeness is not yet enforced by schema types.

The frontend inventory and remaining gaps are documented in
`docs/graphql-contract-campaign.md` in the frontend repository. Phase 2 validates
all extracted operations against this pinned contract. Phase 3 generates typed
operation documents; phase 4 enforces custom response shapes. Schema validation
alone does not catch runtime-invalid nullable filters or incomplete projections.
