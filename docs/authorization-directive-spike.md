# `@authorization` read-path spike

Issue: [#211](https://github.com/gennit-project/multiforum-backend/issues/211)

## Scope

This spike migrates notification read ownership from a field-level
`graphql-shield` rule to an `@neo4j/graphql` v5 filter:

- `Notification` has an inverse `User` relationship over `HAS_NOTIFICATION`.
- `READ` and `AGGREGATE` operations filter that relationship by the verified
  application username.
- `User.Notifications` is now open in shield because ownership is enforced in
  the generated Cypher. Notification mutations remain denied by shield.

This protects every generated read path, including the root `notifications`
and `notificationsAggregate` queries. Previously, shield protected traversal
through `User.Notifications`, but the generated root queries inherited the
public `Query.*` rule.

## Identity wiring

The provider JWT cannot be passed through unchanged. Auth0's `sub` identifies
the Auth0 principal, while graph ownership is keyed by `User.username`; local
development and mock providers also have different verification paths.

The Apollo context therefore reuses `setUserDataOnContext`, the existing
provider-aware verifier and username lookup, and passes this minimal decoded
payload to Neo4j GraphQL:

```ts
{ jwt: { sub: verifiedApplicationUsername } }
```

Neo4j GraphQL documents decoded `context.jwt` as the extension point for custom
decoding. Shield reuses the populated `context.user`, so requests that need
shield rules do not repeat the username lookup.

## Verification and generated query behavior

The focused tests execute the generated resolver with a capturing driver. They
verify that authenticated notification reads compile a `HAS_NOTIFICATION`
traversal and username predicate into Cypher, and that requests without a
decoded identity compile with `isAuthenticated = false`. Schema generation and
the existing permission tests provide compatibility coverage for the rest of
the middleware stack.

## Findings and recommendation

**Go, incrementally, for owner-scoped node types.** A type-level filter can
replace shield rules that only determine which nodes a caller may see. It also
covers root, nested, and aggregate reads consistently and filters before
pagination and counts.

Broader migration should account for these constraints:

1. Auth identity must be normalized to graph identifiers before translation.
   This spike resolves that once per authenticated request. Measure the added
   lookup cost on public read-heavy traffic before migrating many types.
2. Filter rules intentionally return fewer nodes instead of shield-style field
   errors. Client behavior should be checked wherever an authorization error is
   currently part of the contract.
3. `@authorization` does not protect subscription events. Each migrated type
   needs a separate `@subscriptionsAuthorization` design, or its generated
   subscriptions must be disabled, before shield can be retired broadly.
4. Mutation validation and custom error messages remain in shield. This spike
   does not justify removing the patched dependency yet.

The recommended next slice is another owner-scoped read type with a stable
username relationship. Role- and permission-based types should wait until the
identity lookup cost and subscription policy have been resolved.
