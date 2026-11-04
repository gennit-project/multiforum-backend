# Resolver response contracts: cumulative #413 campaign

GraphQL already validates requested response fields during execution. A nullable
field may correctly complete as null (including an undefined resolver result);
non-null failures bubble according to the schema. Loose TypeScript annotations
alone do not demonstrate a live bug. This migration catches selected mismatches
before execution and adds executable-schema response evidence.

## Migration inventory and boundary

`resolver-contract-inventory.json` lists all 209 custom composition entries,
including query, mutation, object, union and scalar implementations. At this
checkpoint, 173 entries have a checked selected response boundary and 36 remain
`deferred`. Selected-response is deliberately narrower than full-entity or
end-to-end behavior certification: the exact selected paths and residual paths
are recorded in `resolver-contract-audit/*.json` for all 191 post-pilot entries.
The original 18 voting/subscription/reaction boundaries are described below.
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
  and keeps selected status aligned with the enforced registration maps. New or
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
label a selected projection as full-object coverage. Remaining entries are tracked
in the cumulative campaign inventory above; broader child-field coverage and
custom scalar internals are explicit residual boundaries. These selected slices
alone do not complete #413.


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

## Cumulative risk-ranked checkpoint

The campaign extends the same draft PR after merging current main. It adds no
public schema or permission changes of its own; the branch also contains main's
independent fixes, including the bot suspension permission fix (#437).

| Family | Selected boundaries | Scope |
| --- | ---: | --- |
| Original voting/subscriptions/reactions | 18 | Existing pilot retained |
| Moderation actions | 33 | Wiki actions, sticky comments, soft deletion, locks, undo vote, reports, suspensions and archives |
| Plugin contracts | 36 | History, reviews, configuration, installation, campaigns, execution, summary metadata and download reads/writes |
| Accounts, collections and age/privacy | 45 | Scalar actions, precise projections, age checks and signing |
| Content writes and revisions | 16 | Exact schema-executed writes, nullable input/error order |
| Content query scalars and pagination | 18 | Scalars, page-info, viewer state and contribution/wiki counts |
| Object/union fields | 7 | Union names, page-info, URL access and collections |

`contracts/registry.ts` names the checked composition variables. Inventory tests
inspect each actual `satisfies` boundary, reject missing/duplicate registrations,
and compare the executable composition root with the complete inventory. The audit
guard requires every post-pilot entry to have source/test evidence, selected paths,
residual paths and a specific next step. A deferred entry is not a finding that
production is broken. Routine unfinished work is distinguished from a behavior or
schema decision; neither is counted as checked.

The common declaration helper supports scalar arrays and exact generated enum
string values. It does not accept arbitrary strings for enums or widen selected
objects to blanket partials. Negative fixtures are compile-only under tests.
JSON and DateTime scalar internals remain outside generated structural guarantees.

### High-value execution evidence

`botSuspensionConnection.test.ts` executes the actual generated schema through
permission middleware on disposable Neo4j: anonymous forum reads include bot
suspension counts, active/indefinite filtering, and empty bot lists. Public moderator
suspension counts do not grant access to the private moderator identity edge.

New response tests cover permission denial, null completion, repeated actions,
configuration no-change/blocked/partial failure and secret redaction, age/privacy
status, and storage signing through a test-only dependency seam. No tests use live
storage, email, production Neo4j, or shared staging data.

### Explicit remaining decisions and observed behavior

- Raw database property maps and opaque parent-list items cannot honestly be
  certified by a full-entity cast. Tests prove that malformed **unselected** fields
  may succeed while selecting them yields a field-level serialization error.
  Eager row-wide decoding would change accepted requests and sometimes post-commit
  failure timing. A selection-aware completion strategy is needed for these paths.
- Event creation still has the post-commit empty-refetch race. Ordinary discussion
  creation and sharing are fixed by #447/#448: owned writes and fixed response
  validation share an item transaction; the captured response survives plugin edits.
  Their signatures remain deferred because the shared helper also includes the
  separate crosspost branch and lacks a proven nonempty ordinary-create contract.
  This is unfinished type work, not the old ordinary-create race.
- Image/profile/icon variants are fixed by #445, using compatible JSON text
  storage and public normalization. Regression tests now assert nonempty variants
  and successful upload claims; unrestricted JSON remains a separate boundary.
- Dynamic caller-selected activity responses and unrestricted JSON scalars need
  their own explicit boundary strategy. Selected pagination metadata does not
  certify the accompanying raw item maps.

These limits are documented per field rather than hidden behind the issue's closed
state or a percentage. Completing more routine slices and resolving the remaining
boundary decisions is required before describing the campaign as complete.

## Current campaign accounting and decisions

All 209 custom entries have been reviewed: 173 have a checked selected
response/source boundary (82.8%); 36 remain explicit exceptions. This is **not** complete
end-to-end response certification. The remaining entries are 1 moderation,
27 object/scalar fields, 1 content query, 1 account/storage action, 2 content
writes and 4 plugin entries. Per-field selections, reasons and evidence remain
in the six audit files rather than being hidden by the closed issue status.

Two JSON-returning pipeline update mutations additionally have generated argument
and explicit domain-array checks at their actual registration map. Their schema
output is unrestricted JSON, so neither is counted as a generated output guarantee.
The domain map has its own drift guard. Pipeline page metadata and numerical health
summaries are checked separately from their raw nested rows.

Additional real-schema evidence requiring a behavior decision:

- Campaign pause/resume can lose the row between status lookup and update and
  return undefined for a non-null response. Both remain deferred.
- Download creation/deletion response defects were fixed separately in merged
  #440. This branch incorporates that fix and replaces the old failure witnesses
  with successful real-schema response assertions; malformed unselected fields
  still remain lazy. No storage or permission policy is changed here.
- Merged #442 fixes the two Discussion pipeline selections and revision guards.
  Precise projections and real execution tests now assert the supported paths.
- Uploaded-file channel names and review author fallback were fixed separately in
  merged #441; canonical-graph and permission regressions now assert correct results.
  Raw nested leaves remain outside the selected uploader/status contract.
- An installed version with no Plugin link can return safe selected fields but
  fails when non-null plugin identity fields are requested. Those identities remain
  outside the checked selection; access policy is unchanged.

These tests characterize existing defects; they do not silently repair queries,
change missing-record policy, fill new response metadata, or alter commit timing.
The remaining raw/lazy paths need an explicit selection-aware boundary design.
Eager validation is not an equivalent substitute: it can reject unrequested fields
and move failures before writes that currently commit. JSON/scalar-owned structure
requires a separately defined contract rather than a vacuous generated `any` check.


### Source-provenance continuation after #440

The additional 47 boundaries check values established by the existing queries or
constructors: matched identifiers, SET values, randomUUID/datetime/toString,
explicit list comprehensions, CASE/EXISTS booleans and aggregate counts. Fixed
projections state those facts and leave other persisted values unknown. They do
not turn a raw property map into a complete schema entity. Tests cover missing
records, nullable completion, permission/error paths and post-write serialization
without adding eager validation or changing transaction order.

Issue lock metadata has a direct SDL nullability guard because DateTime's existing
generated `any` mapping otherwise hides a non-null change. Wiki aggregate counts
use a local accepted-source signature for just that field: the existing Neo4j
numerical child resolver completes Integer or number to GraphQL Int. Executable
schema tests guard Int!, child completion, zero/empty results and range failures.
This does not widen all generated Int outputs or certify raw wiki page fields.

Image creation tests retain the existing lost-upload-claim behavior after image
creation; changing claim/race policy is separate work. The 36 deferred entries and
residual paths within the 173 selected entries still need explicit source or
selection-aware contracts. This checkpoint is not completion of the full campaign.


### Selection-aware continuation after #443

Merged #442/#443 fixes are reconciled with the precise pipeline projections and
successful selection regressions. All 23 opaque list registrations check generated
call signatures and list-container nullability; delegated activity payloads check
root arguments and their child method convention. Items and delegation results
remain unknown, so accounting stays **173 selected / 36 deferred**. These source
checks cannot substitute for selection-dependent child types. Drift guards and
negative fixtures keep that distinction explicit.

Three variant-URL registrations retain explicit string-map-or-null domain checks
without claiming guarantees from unrestricted JSON. The image-usage whole-result
cast is replaced by an exact nested raw projection; merged #444 fixes its graph traversal while the raw nested leaves remain unknown. See [next decisions](resolver-contract-next-decisions.md)
for the remaining race choices and precise limits. No race policy changes are made.


### Executed fixed-projection checks after #444

All ten start/rerun pipeline repository operations now have a schema-executed
selection drift guard against their declared generated projections. It preserves
response aliases, same-object fragments and merged selections, and rejects
conditional/abstract cases requiring a different contract. An omitted title in
the actual query was confirmed to fail the guard, then restored. Existing real
persistence tests remain necessary: this check validates documents and projection
paths with empty root data, not arbitrary driver values or JSON interiors.
#444's passing image-usage graph/permission regressions replace the old omission
witness. Counts remain 173 selected / 36 deferred; no race policy is changed.

### Main reconciliation through #448

Incorporates #445, #447 and #448, preserving the campaign's precise persistence
projections alongside merged transaction/variant behavior. Former discussion/share
missing-response witnesses now assert transactional rejection and rollback; profile
and icon witnesses assert successful variants. Counts remain 173 selected and 36
deferred: no signature is promoted solely because its behavior defect was fixed.

The reconciliation also forwards the existing seed request context to discussion
creation (matching event creation). The populated Cypress seed regression exposed
that missing context after #447 began requiring successful owned forum links.
