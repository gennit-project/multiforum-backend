---
name: graphql-shield-permissions
description: Add or change authorization on GraphQL fields, queries, and mutations. Use whenever editing permissions.ts or rules/, gating a new resolver, writing or debugging a graphql-shield rule, or reasoning about who can perform an operation. This server is default-deny — every new operation must be explicitly allowed or it is blocked.
---

# GraphQL authorization (graphql-shield) — gennit-backend

Authorization is enforced with **graphql-shield** in `permissions.ts`, applied as
`graphql-middleware` over the schema. The server is **default-deny**: an operation with no
explicit rule is **denied**. Adding a resolver without a permission entry makes it
unreachable — wire up the rule in the same change.

## Where things live
- `permissions.ts` — the shield: maps `Query` / `Mutation` / type fields to rules, and sets
  the fallback (`deny`). Composes rules with `and` / `or` / `chain` / `allow` / `deny`.
- `rules/` (imported as `rules/rules.js`) — the named rule predicates: `isRoot`,
  `isAccountOwner`, `isChannelOwner`, `isDiscussionOwner`, `isCommentAuthor`, `canManageMods`,
  `canCreateDiscussion`, `canUploadFile`, `…InputIsValid`, etc. Each is a graphql-shield
  `rule()` that reads identity/roles from the resolver `context` and returns a boolean or an
  `Error`.

## Rules for changing permissions
- **Every new field/mutation needs an explicit entry** in `permissions.ts`. If you add a
  resolver and don't, default-deny blocks it — with no error pointing at the missing rule.
- **Reuse existing predicates** from `rules/` before writing a new one; compose with
  `and` / `or` / `chain` rather than embedding logic inline in `permissions.ts`.
- **Validation rules (`…InputIsValid`) run as part of authorization** via `chain` — keep input
  validation in a rule, not scattered in the resolver.
- **New predicates are pure and context-driven:** derive the answer from `context` + args,
  return a boolean or `Error`; never perform writes in a rule.
- Keep the model aligned with the permission architecture in `README.md` / `docs/` (server-
  scope vs channel-scope) rather than inventing a new one.

## Testing
- Auth is unit-tested (e.g. `tests/auth/mutationAuth.test.ts`) — add/extend a case proving the
  operation is **allowed for the intended actor and denied for everyone else**.
- Cover the deny path end-to-end for sensitive mutations with an integration test using the
  right context — see [write-integration-test](../write-integration-test/SKILL.md).

## Related
- Wiring the resolver itself (structure, Cypher, OGM): the custom-resolver conventions and,
  for the Neo4j/GraphQL library layer, [neo4j-graphql-skill](../neo4j-graphql-skill/SKILL.md).

## Before finishing
`pnpm run tsc`, the auth tests, and (for schema-shape changes) `pnpm run codegen` must pass.
