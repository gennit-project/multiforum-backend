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

## Candidate compatibility and publication gate (#701)

`graphql-compatibility/supported-frontends.json` is the reviewed supported-client
set. It pins the canonical frontend repository, full commit, operations SHA-256,
document count and purpose. The first target is frontend #708 commit
`3947cdf3a0d7f84918e81b75b2de433931dc084e` (355 production documents). This is a
source compatibility target, not evidence of deployed revisions or permission
to retire older/cached clients. Deployed and rollback revisions remain unknown.
Before a rollout, maintainers must record those revisions and add every active
and rollback client. Missing historical inventories are missing evidence, not a
pass. #413 and live deployment discovery are outside this change.

The existing exporter remains the only candidate schema producer. From a clean
backend checkout with frozen dependencies:

```sh
pnpm schema:export
pnpm schema:compatibility
node --import tsx --test tests/contracts/frontendCompatibility.smoke.ts
pnpm test:frontend-contracts
```

The backend-owned TypeScript checker implements the same operation validation,
full breaking/dangerous schema diff, and original-baseline semantics as frontend
`scripts/check-backend-compatibility.mjs`. It fetches only JSON, SDL and lockfile
data from fixed public GitHub paths at each immutable supported SHA. It never
installs frontend packages or executes frontend code. Checksums and original
schema manifests bind every input; the candidate revision and lockfile must match
the current clean checkout. Unknown/missing inputs, empty or duplicate support
sets, malformed provenance and validation errors fail closed. There is no waiver,
mutable-ref fallback, environment override or live endpoint introspection.

The committed operation snapshot is produced and freshness-checked by frontend
#708 CI using its strict extractor. Backend pins must be reviewed against that
successful exact-source CI evidence, including generated-type freshness. The
backend verifies its pinned snapshot checksum, individual document hashes,
source references/count, original schema pin and frontend lockfile. It does not
re-run a different extractor or claim to independently certify source coverage.
Changing the frontend target or checksum is a reviewed dependency change, not
routine baseline regeneration. A SHA checksum establishes integrity, not trust
in an arbitrary producer.

`.github/workflows/graphql-compatibility.yml` is one reusable, read-only gate
called by Tests CI and Container image for the same checkout. It exports the
candidate, validates every client and original baseline, proves real wiki/issue/
album rejection and additive compatibility, and runs the existing four-family
schema/permissions/persistence suite on disposable Neo4j. Only then is the
`graphql-schema-<checkout SHA>` artifact uploaded. Both image-build paths depend
on this gate; registry publication and multi-platform assembly cannot run after
a failed gate. No secrets are inherited, no PAT is required, and no privileged
`pull_request_target` or `workflow_run` execution is introduced. Existing full
integration shards and image smoke are retained. No branch protection changes
are made. Artifact publication is a technical CI gate, not deployment approval.

`frontend-compatibility-<checkout SHA>` retains a deterministic report, supported
operation snapshots and original schemas/manifests, or failure diagnostics.
Reports identify candidate and client revisions/hashes, source file/line/document,
and full breaking/dangerous changes. Missing data/network failures produce
`failure.txt` and nonzero exit, never a partial pass. PR artifacts identify the
synthetic merge checkout, not the PR head; reproduce with the exact commit and
frozen lockfile. Each caller has its own run-scoped artifacts.

For intentional breaks, both repository owners must review the affected clients,
full diagnostics, retirement evidence, migration strategy and tested rollback
pair before changing support. Never replace an existing client's original schema
baseline to conceal a failure. There is no assumed N-1 expiry policy. Historical
#415/#707 evidence shows both mixed pairs fail (old frontend/new backend issue
input; new frontend/old backend five album/issue/wiki validation errors). Use an
additive bridge or a coordinated paired cutover; do not assume backend-first is
safe. Static validation cannot prove runtime values, authorization or persistence;
the real-schema tests cover crosspost references, new/reused-image ownership,
issue identity/numbering/targets and wiki home/history/editor attribution.

See frontend [cross-repository release guidance](https://github.com/gennit-project/multiforum-nuxt/blob/3947cdf3a0d7f84918e81b75b2de433931dc084e/docs/cross-repository-releases.md)
for evidence collection, intentional-break review and paired rollback. Shared
staging/production writes, deployment, and live-version verification are not
performed by this gate.
