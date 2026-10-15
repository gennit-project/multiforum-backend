# `@authorization` read-path spike

Issue: [#211](https://github.com/gennit-project/multiforum-backend/issues/211)

## Scope

This spike migrates notification read ownership from a field-level
`graphql-shield` rule to an `@neo4j/graphql` v5 filter:

- `Notification` has an inverse `User` relationship over `HAS_NOTIFICATION`.
- `READ` and `AGGREGATE` operations filter that relationship by the verified
  application username.
- The inverse relationship is excluded from generated create and update inputs,
  so exposing it for authorization cannot reassign notification ownership.
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
provider-aware verifier and consolidated username lookup, and adds the verified
application username to the server-owned Neo4j GraphQL claims:

```ts
{
  jwt: {
    ...serverComputedClaims,
    sub: verifiedApplicationUsername,
  },
}
```

Neo4j GraphQL documents decoded `context.jwt` as the extension point for custom
decoding. The server already uses this mechanism for the
`mayAccessSensitiveContent` claim, so the identity helper preserves that claim
and discards any unverified `sub`. Shield and the sensitive-content policy reuse
the populated `context.user`, avoiding a duplicate identity lookup.

## Verification and generated query behavior

The focused tests execute generated resolvers with a capturing driver. They
verify that root, nested, and aggregate notification reads compile a
`HAS_NOTIFICATION` traversal and username predicate into Cypher. Anonymous
requests, including requests carrying only unrelated server claims, fail
closed. Schema tests also verify the inverse relationship is unavailable in
generated create and update inputs. Existing permission tests confirm that
Shield delegates the notification traversal without blocking public profile
queries. A Testcontainers-backed integration test executes the generated
queries against Neo4j and confirms that root reads, aggregates, and nested
traversals return only the verified caller's notifications.

## Findings and recommendation

**Go, incrementally, for owner-scoped node types.** A type-level filter can
replace shield rules that only determine which nodes a caller may see. It also
covers root, nested, and aggregate reads consistently and filters before
pagination and counts.

Broader migration should account for these constraints:

1. Auth identity must be normalized to graph identifiers before translation.
   This spike resolves that once per authenticated request and shares the
   result with Shield and the sensitive-content policy. Measure the lookup cost
   before migrating many types that appear on otherwise-public operations.
2. Filter rules intentionally return fewer nodes instead of shield-style field
   errors. Client behavior should be checked wherever an authorization error is
   currently part of the contract.
3. `@authorization` does not protect subscription events. The existing age-gate
   implementation demonstrates the separate `@subscriptionsAuthorization`
   pattern. Notification subscriptions remain denied by Shield's fallback; any
   future exposure needs an explicit owner-scoped subscription policy.
4. Mutation validation and custom error messages remain in shield. This spike
   does not justify removing the patched dependency yet.

The recommended next slice is another owner-scoped read type with a stable
username relationship. Role- and permission-based types should wait until the
identity lookup cost and subscription policy have been resolved.
