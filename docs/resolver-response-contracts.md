# Resolver response contracts: #413 foundation, voting, subscriptions and reactions

GraphQL already validates requested response fields during execution. A nullable
field may correctly complete as null (including an undefined resolver result);
non-null failures bubble according to the schema. Loose TypeScript annotations
alone do not demonstrate a live bug. This migration catches selected mismatches
before execution and adds executable-schema response evidence.

## Migration inventory and boundary

`resolver-contract-inventory.json` lists all 209 custom composition entries,
including query, mutation, object, union and scalar implementations. Four regular
vote mutations, ten subscription mutations and four emoji reaction mutations have
status `selected-response` (18 total); the other 191 are `deferred`.
This is not a statement that deferred resolvers are incorrect. Generated Neo4j
CRUD resolvers are outside this custom-resolver inventory.

The existing code generator already emits `MutationResolvers`, `ResolverFn` and
schema entities into ignored `src/generated/graphql.ts`. No new schema generator
or public schema is introduced. `customResolvers/contracts/selection.d.ts` derives
a selected resolver signature from those generated types. It retains generated
parent, arguments, context and GraphQLResolveInfo, recursively checks explicitly
selected result fields, and preserves nullability. It permits undefined only for
nullable generated results, matching GraphQL completion. It does not apply a
blanket Partial to entities or cast incomplete data to full objects.

`customResolvers/contracts/voting.ts` records the pilot fields: id, weighted vote
count, voter usernames, connection totalCount and aggregate.count.nodes. The
mutation composition's `satisfies VotingMutationResolvers` checks the actual four
factory outputs without widening their useful inferred types. Other fields,
connection edges/pageInfo, union resolution, scalars mapped to any by existing
codegen, and other resolver families are not certified by this selected boundary.
The legacy non-schema `UpvotedByUsersAggregate` property is retained for existing
internal callers; this pilot does not present it as a GraphQL field.

The two vote repositories now describe their actual fixed selections rather than
returning full Comment, DiscussionChannel or User types. Nested author selections
preserve union/nullability and selected voter fields omit unfetched properties.
These are projection types, not validation of arbitrary driver rows: the existing
`executeGeneratedOperation<T>` remains a trusted generic adapter, and repository
integration tests verify actual generated-operation projections. Future slices
can add operation-generated result types or decoding at their own boundaries.

## Preserved voting behavior

No queries, transaction sequencing, vote/karma math or permission predicates are
changed. Karma writes still use a separate generated-operation session from the
raw vote transaction. Existing tests retain the committed-write/serialization-
failure behavior; this PR does not claim new cross-session atomicity.

Both upvotes and discussion-channel undo log caught failures and return undefined.
Comment undo logs and rethrows. Through GraphQL, the swallowed nullable result is
null without a GraphQL error; comment undo exposes an error and nullable null.
Missing records and repeated requests retain these distinctions. Argument checks
before the catch retain their existing errors.

Voter reads intentionally remain unchanged: comment voting fetches username and
commentKarma; discussion voting fetches username and discussionKarma. Neither
fetches createdAt, and discussion voting does not fetch commentKarma. The helper
now states its optional inputs rather than requiring a fictitious full User.
This preserves existing bonus calculations. The nested voter-list default limit
of 25 and its existing list-based count behavior are also unchanged; the existing
repository snapshots demonstrate the difference from the unbounded aggregate.
Changes to these semantics need a separate reviewed task.

## Checks and extending the migration

CI's existing codegen, tsc and unit gates enforce this pilot without requiring a
whole-backend migration:

- `tsc` compiles `tests/contracts/voting.typecheck.ts`, including negative cases for invalid
  argument/scalar types, missing selected connections, null non-null counts,
  undefined non-null results, unknown fields and access to unfetched properties.
  Unused `@ts-expect-error` directives fail if a boundary becomes permissive.
  These compile-only fixtures live under tests, outside application runtime
  coverage. The reusable type-only helpers use a `.d.ts` declaration file;
  the existing coverage exclusions and thresholds are unchanged.
- `resolverContractInventory.test.ts` checks all builder fields and the actual
  composition root against the reviewed inventory, prohibits duplicate entries,
  and keeps selected status aligned with the fourteen enforced mutations. New or
  removed custom fields require an explicit inventory decision. Inventory-only
  edits still run the existing unit/coverage check on docs-only CI.
- `voteResponseContracts.test.ts` executes the real augmented schema, tests
  counts/connections, zero votes, repeat/missing results, injected repository
  failures, nullable completion and non-null serialization. Successful calls and
  anonymous denial run through the existing permission middleware. Direct schema
  calls isolate resolver error behavior from permission-layer missing-record
  rejection. Existing auth, transaction-ordering, repository and voting tests
  continue covering behavior.

Focused validation after `pnpm codegen`:

```sh
pnpm tsc
node --import tsx --test build_scripts/resolverContractInventory.test.ts
node --import tsx --import ./tests/helpers/snapshotSerializer.ts --test --test-concurrency=1 \
  tests/integration/voteResponseContracts.test.ts \
  tests/integration/voteResolvers.test.ts \
  tests/integration/commentVoteRepository.test.ts \
  tests/integration/discussionVoteRepository.test.ts
```

Use disposable local Neo4j only. Full CI retains all integration shards and the
#701 schema/frontend compatibility gate. Schema hash must remain unchanged.

For a later slice, choose explicit schema fields, accurate repository projections,
compile-negative cases and real-schema response tests. Add its checked composition
boundary, then promote only that inventory entry with reviewed evidence. Do not
label a selected projection as full-object coverage. The remaining 195 entries,
other repository projections, broader child-field coverage and custom scalar
mapping remain outside this PR; #413 is not completed by these slices.


## Subscription slice: ten mutations, five projections

All subscribe/unsubscribe registrations for Comment, DiscussionChannel, Event,
EventUpdates and Issue now pass `SubscriptionMutationResolvers` at composition.
Each selection lists the actual response fields, including the correct subscriber
relationship. `SubscribedToEventUpdates` is distinct from
`SubscribedToNotifications`; neither is an optional catch-all property.

`subscriptionTargetRepository.ts` returns five target-specific types. Required
selected fields and subscriber arrays are required properties; nullable selected
scalars explicitly admit null. Each decoder uses the existing scalar serializer
with its declared output type, preserving projection/first-error order. There is
no final cast from a dynamic property bag to a pretend full entity. The fixed
Cypher query guarantees the raw `subscribers` list shape; its existing narrow raw
shape assertion remains, and each username is still scalar-validated.

The Cypher queries, numeric-ID/Int conversion, DateTime formatting, Boolean/String
coercion and errors, 25-root/subscriber limits, duplicate behavior and visibility
filters are unchanged. In particular, native Neo4j integers are not interchangeable
with JavaScript floating numbers for every scalar. Existing repository snapshots
retain those distinctions. Managed READ sessions retain their existing bookmark
manager and database settings; this slice does not introduce replica routing.

All ten mutations authenticate, perform their existing raw write, then read the
selected response. Missing/filtered targets complete as nullable null. A read or
serialization failure still follows an already committed write; it does not roll
back that write. Write/read errors are still wrapped and rethrown with the existing
operation-specific message. Comment, discussion-channel and issue reads filter
`ageGateRestricted`; event and event-update reads retain their existing exception.
No permission or subscription behavior is changed by this type migration.

`tests/contracts/subscriptions.typecheck.ts` adds compile-negative examples for
missing required fields/lists, target confusion, wrong arguments, non-null and
scalar mismatches, and access to fields not selected by a target query. The
inventory guard checks both typed composition blocks against the 14 selected
entries, including all ten actual subscription registrations.

`subscriptionResponseContracts.test.ts` executes both mutations for every target
through the augmented GraphQL schema and authentication middleware. It covers
populated/empty lists, repeated operations, missing targets, nullable scalars,
anonymous denial, the 25-subscriber cap, age-gate filtering, malformed database
fields/subscribers, and injected driver read/write failures. It verifies persisted
relationships after failures so write-before-read semantics cannot silently change.
The original repository integration snapshots and ordering tests remain active.
Only this shared subscription boundary is added; other subscription queries and
remaining #413 entries stay deferred.

Run the subscription slice after codegen and type checking with:

```sh
node --import tsx --import ./tests/helpers/snapshotSerializer.ts --test --test-concurrency=1 \
  tests/integration/subscriptionTargetRepository.test.ts \
  tests/integration/subscriptionResponseContracts.test.ts
```

## Emoji reaction slice

All four add/remove emoji mutations for Comment and DiscussionChannel are checked
at their actual composition registrations via `satisfies ReactionMutationResolvers`.
The selected response is `id` and `emoji`; it is not a full entity. The two emoji
validation reads in `contentValidationRepository` now describe their exact scalar
and nested channel/discussion projections, including nullable relationships and
flags. Other validation methods are outside this slice.

The JSON scalar remains mapped to an unrestricted output by existing codegen.
The selected signature checks presence of `emoji`, not its internal shape. Current
reaction responses contain a JSON-encoded string, not a parsed object. Executable
schema tests assert that representation, empty initialization and repeated changes.
No JSON validation/coercion policy is added by this typing migration.

Queries, scalar serializers, permission rules, argument checks, channel preference
precedence, locked/archived checks and write projections remain unchanged. Read or
JSON parse failures occur before writing; generated writer projection failures can
follow committed writes. All four resolvers log/rethrow caught errors, which
GraphQL reports with a nullable null response. The writer's unused default scalar
projection remains intact because removing it would change errors and event behavior.
The generated-operation adapter remains a trusted generic boundary; repository
integration tests and GraphQL execution tests provide runtime projection evidence.

Run the focused tests, then type-check:

```sh
node --import tsx --import ./tests/helpers/snapshotSerializer.ts --test --test-concurrency=1 tests/integration/reactionResponseContracts.test.ts tests/integration/reactionWriter.test.ts tests/integration/contentValidationRepository.test.ts
pnpm run tsc
```
Compile-negative fixtures stay under `tests/contracts/reactions.typecheck.ts`.
