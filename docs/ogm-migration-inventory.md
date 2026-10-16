# OGM migration inventory

This document records the starting boundary for
[#284](https://github.com/gennit-project/multiforum-backend/issues/284). It is a
migration map, not a recommendation to replace every call in one pull request.

## Baseline

The original baseline contained:

- 65 files that call `ogm.model(...)` directly;
- 179 files that import generated definitions from `ogm_types.ts`;
- one module permitted to import the concrete `@neo4j/graphql-ogm` runtime:
  `services/persistence/ogm.ts`, which constructs the temporary adapter.

Direct model lookup is concentrated in these areas:

| Area | Files | Migration concern |
| --- | ---: | --- |
| `rules/` | 38 | Authorization behavior must remain fail-closed and leader-routed. |
| `middleware/` | 10 | Writes and side effects must retain transaction ordering. |
| `services/` | 6 | Background workers need explicit retry and idempotency semantics. |
| `customResolvers/` | 5 | Resolver inputs and generated selection shapes must stay compatible. |
| `hooks/` | 4 | Version-history and notification effects must not be duplicated. |
| `seedData/` | 1 | Startup provisioning must stay idempotent. |
| `types/` | 1 | The legacy context type remains coupled until its callers move to repositories. |

Generated OGM types are even more widespread: 140 of the 179 production files
are custom resolvers. Their replacement is therefore a separate code-generation
workstream from replacing runtime model access.

The baseline can be reproduced with:

```sh
rg -l '\bogm\.model\(' --glob '*.ts' --glob '!**/*.test.ts' \
  --glob '!tests/**' --glob '!build_scripts/**' --glob '!ogm_types.ts'

rg -l 'ogm_types\.js' --glob '*.ts' --glob '!**/*.test.ts' \
  --glob '!tests/**' --glob '!build_scripts/**' --glob '!ogm_types.ts'
```

## Replacement boundary

New persistence code should depend on `Repository<Model>` or
`RepositoryProvider<ModelMap>` from `services/persistence/repository.ts`. The
temporary adapter in `services/persistence/ogm.ts` binds the existing OGM
methods to those application-owned interfaces. ESLint rejects any new runtime
import of `@neo4j/graphql-ogm` outside that adapter; temporary type-only imports
remain allowed while legacy call sites are migrated.

The contract intentionally preserves each generated model's `find`, `create`,
`update`, and `delete` signatures. This lets a domain move to parameterized
Cypher and the JavaScript driver without forcing its callers to migrate in the
same pull request. OGM-only operations such as `aggregate` are excluded from the
common contract and need an explicit domain-specific interface when encountered.

The first migrated production path is the standalone default-role provisioning
command. Its domain logic now receives repositories; the legacy OGM entry point
is retained as a compatibility wrapper for server startup and integration tests.

The central server-config permission read is also driver-backed. It uses a
domain-specific repository with an explicit database and retains leader routing
so authorization checks continue to observe current writes through the
request-scoped bookmark manager. Permission decisions and GraphQL Shield rules
remain unchanged. This reduces the production files with direct
`ogm.model(...)` access from 65 to 64; generated OGM type imports remain at 179.

Bootstrap-admin provisioning is now also driver-backed. Identity collision
checks, first-user creation, ServerConfig verification, and the SuperAdmin
relationship are reconciled in one managed write transaction so any failure
rolls back the complete bootstrap attempt. Startup continues to share the
application driver while default-role provisioning remains behind the OGM
repository adapter. This reduces the production files with direct
`ogm.model(...)` access from 64 to 63.

Default-role and ServerConfig provisioning is now driver-backed as well. Role
upserts, ServerConfig creation, default-role relationship reconciliation, and
the Admin-to-SuperAdmin backfill run in one managed write transaction. Both
startup and the standalone provisioning command share the application driver;
neither initializes an OGM for this work. This reduces production files with
direct `ogm.model(...)` access from 63 to 62 and generated OGM type imports from
179 to 178.

Suspension side effects are now driver-backed. Expired channel and server
suspensions remove only their active scope relationships, retaining suspension
nodes and user/profile relationships as an audit trail. Suspension-block
notifications are created with parameterized Cypher and deduplicated against
identical unread notifications. This reduces production files with direct
`ogm.model(...)` access from 62 to 58 and generated OGM type imports from 178 to
175.

Comment, discussion, and wiki-page background version-history services are now
driver-backed. Author lookup remains leader-routed, and each TextVersion plus
its author and parent relationships is created atomically in a managed write
transaction. The explicit Cypher reproduces the OGM-generated id, createdAt,
and ageGateTouchedAt values. This reduces production files with direct
`ogm.model(...)` access from 58 to 54; generated OGM type imports remain at 175.

Moderator edit and sticky-comment rules now resolve their target content's
channels through a driver-backed permission repository. The repository covers
direct channel comments, discussion comments, event comments, issue activity,
discussion channels, and event channels while preserving the distinction
between missing content and content without a channel. These authorization
reads remain leader-routed so request bookmarks provide read-your-own-writes
behavior. This reduces production files with direct `ogm.model(...)` access
from 54 to 50; generated OGM type imports remain at 175.

Core channel authorization reads are now driver-backed. User and moderator
permission checks share a narrow channel snapshot containing lock state,
owners, moderators, and channel roles; suspension classification consumes
targeted repository results without an OGM fallback. The multi-channel content
gate reuses the same snapshot for its lock and role checks, while direct checks
retain the existing server-admin short circuit. Authorization sessions specify
the configured database and remain leader-routed for causal consistency. This
reduces production files with direct `ogm.model(...)` access from 50 to 46,
direct calls from 125 to 120, and generated OGM type imports from 175 to 172.

## Recommended migration order

1. Move read-only permission helpers to narrow repositories, preserving leader
   routing until request bookmarks are propagated end to end.
2. Move idempotent startup and maintenance services.
3. Move resolver writes one domain at a time, keeping related middleware and
   managed transactions in the same slice.
4. Replace `ogm_types.ts` generation after runtime OGM calls are gone.
5. Remove the adapter and package, then proceed with GraphQL 7 and Driver 6.

Every domain slice should keep its existing unit coverage and add a live Neo4j
integration test for generated projections, permissions, and transaction
behavior where applicable.
