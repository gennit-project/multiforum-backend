# Resolver response contracts: cumulative #413 campaign

GraphQL already validates requested response fields during execution. A nullable
field may correctly complete as null (including an undefined resolver result);
non-null failures bubble according to the schema. Loose TypeScript annotations
alone do not demonstrate a live bug. This migration catches selected mismatches
before execution and adds executable-schema response evidence.

## Migration inventory and boundary

`resolver-contract-inventory.json` lists all 209 custom composition entries,
including query, mutation, object, union and scalar implementations. At this
checkpoint, 176 entries have a checked selected response boundary and 33 remain
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
- Event creation now validates its fixed response inside the item transaction (#449),
  omitting failed items while continuing the batch. Ordinary discussion
  creation and sharing are fixed by #447/#448: owned writes and fixed response
  validation share an item transaction; the captured response survives plugin edits.
  Discussion successful elements are now checked after #450. The sharing wrapper
  now checks a nonempty array contract; the old creation race is fixed.
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

All 209 custom entries have been reviewed: 176 have a checked selected
response/source boundary (84.2%); 33 remain explicit exceptions. This is **not** complete
end-to-end response certification. The remaining entries are 1 moderation,
27 object/scalar fields, 1 content query and 4 plugin entries. Per-field selections, reasons and evidence remain
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
creation; changing claim/race policy is separate work. The 33 deferred entries and
residual paths within the 176 selected entries still need explicit source or
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

### Event result enforcement and creation-query guards after #449

At the creation checkpoint: **175 selected / 34 deferred**. The event mutation now checks
its precise non-undefined successful result at the actual generated registration.
The four actual discussion/event create and response-read documents have executable
projection-drift checks; persistence/rollback tests remain separate evidence.
Collection sharing now checks the nonempty ordinary-create result described below.
The crosspost runtime guard is incorporated from #450.

## Crosspost safeguards after #450

At the crosspost checkpoint: **175 selected / 34 deferred**. The merged runtime guard is
preserved without changing permission, sensitive-content, ownership or batch policy.
Successful discussion elements are checked at the actual generated registration.
The ID-only CreateCrosspost result has its own generated identity projection;
CrosspostResult retains the shared complete selected projection. Real GraphQL/Neo4j
execution records both actual documents and compares selected response paths, while
negative type fixtures reject unfetched fields and invalid identities. This does
not certify arbitrary JSON, outer completion, delivery or generic adapter internals.
The later collection-sharing slice below resolves the nonempty helper/wrapper contract
without hiding cardinality behind unchecked indexing.
The previous crosspost runtime dependency is resolved by #450.

### Attachment processing reconciled from #451 and #452

Crosspost attachment lookup remains inside the write transaction, after age-gate
reconciliation, with the original no-JWT filtering context. The internal result
now precisely carries the guarded discussion and attachment ID list. All distinct
eligible files dispatch after commit before channel triggers; individual failures
do not suppress remaining attempts. Merged #452 also performs ordinary attachment lookup inside the per-item write
transaction after visibility reconciliation. Lookup failures roll back that item;
empty or filtered attachment lists remain valid. Earlier committed batch items
are preserved, and retry callbacks do not dispatch external work. The attachment query has a generated ID-only nested
projection and is included in actual executable repository-document drift checks.
No boundary count changes: 175 selected / 34 deferred. Plugin delivery remains
non-durable and outer GraphQL completion remains outside the transaction.

### Collection sharing: nonempty successful creation contract

Current accounting: **176 selected / 33 deferred**. This supersedes the earlier
collection-sharing cardinality limitation. The shared helper rejects empty input,
appends one guarded snapshot per successful item or throws, then explicitly checks
and constructs a nonempty tuple without a cast. Sharing consumes that tuple and
its actual registration checks the same selected generated Discussion projection.
The defensive postcondition runs after item processing; it is not new rollback
protection and does not certify outer GraphQL completion or delivery. Existing
transaction, permission, batch and plugin order are preserved. Compile-negative
fixtures reject empty successful results and dependencies; a deliberately invalid
runtime dependency retains the outer non-null error rather than fabricating data.
Remaining entries are 27 object/scalar fields, four plugin entries, one dynamic
moderation response and one image-usage query. Pause/resume policy remains undecided.

### Campaign transition decision: reproduced stale-status overwrite

The real-schema `pluginCampaignResponseContracts.test.ts` now places a committed
`COMPLETED` update between the status read and the pause/resume write. Both current
mutations overwrite completion with `PAUSED`/`RUNNING` and return the old non-null
`finishedAt`. These are deterministic failure witnesses, not assertions of desired
semantics. Existing deletion, malformed projection, repeat-transition and anonymous
permission regressions remain. No campaign behavior changed and neither boundary
is promoted.

The control-write fix already exists in open, non-draft [#446](https://github.com/gennit-project/multiforum-backend/pull/446),
verified at `207f9118989ad42cad4d01adacf4ebb657cb9268`; it is not merged into
this branch's main base. Do not duplicate it. It snapshots identity/status/version,
locks and rechecks before updating, returns `CONFLICT` for a changed record,
`NOT_FOUND` for disappearance, and retains `BAD_USER_INPUT` for an initially
invalid transition. Its tests cover real blocked transactions and the worker
limitation. Once incorporated, replace the failure witnesses here with assertions
of that contract and carry the precise campaign projection into its new result union.

The separate unanswered product choice is worker behavior after pause: permit the
already-selected batch to dispatch and possibly complete (current behavior), or
stop additional dispatch after acknowledged pause while allowing already-started
jobs to finish, with an explicit decision on whether a paused campaign may become
COMPLETED. #446 does not settle that choice. No worker or control behavior is
changed by this checkpoint.

### Pinned client execution evidence for channel list sources

The exact supported frontend `GET_CHANNEL` and `GET_CHANNEL_PLUGIN_SETTINGS`
documents now execute through GraphQL/Shield with disposable persistence. Their
committed copies are bound to the existing support pin and checked against the
original upstream bundle by the compatibility gate. Coverage includes bot
suspension aggregates, empty/missing forums, private email denial and nullable
malformed child paths. This protects the request shape involved in forum-page
failures, without certifying opaque child types or all frontend operations.
Accounting stays **176 selected / 33 deferred**; source contract engineering is
still distinct from this executable request evidence. No runtime behavior changes.

### Scratchpad upstream source projections

Recipient, comment/discussion source, ownership, visibility and mutation response
shapes now derive from exact generated selections instead of optional-property
catch-alls. Executable-schema guards compare all seven actual repository documents
with those declarations, including the explicit `... on User` author branch.
Compile-negative fixtures reject omitted selected fields and access to unfetched
email/content/vote-cache fields. The actual visibility registration now also checks
its selected nested author and recipient response; GraphQL tests preserve aliases,
fragments, null links and ownership failure before writes.

Counts remain **176 selected / 33 deferred**. This advances the scratchpad source
work, but the separately returned raw super-upvoter username leaves remain unknown.
The moderator-author source failure was subsequently fixed by selecting both
User and ModerationProfile discriminator properties. A real GraphQL/Shield
regression confirms successful moderator-author super-upvotes without user karma,
with unchanged recipients, ordinary User-author karma and permission denials.
Vote limits, age filtering, karma, notifications and write/error ordering remain.

### Dynamic activity delegation input boundary

The actual activity payload now delegates through a query-only helper whose field
name and arguments are checked together against generated QueryResolvers. Compile
fixtures reject misspelled fields, mutation names and incorrect field-specific
filters. The helper preserves the exact context/info and library return value;
errors, nulls and partial child results remain unknown rather than being cast as
complete Issues. The owned write's randomUUID action-ID result is typed precisely.
GraphQL/Shield regressions preserve aliases, fragments, defaults, one write per
mutation, private fields, lazy skipped payloads and post-commit read-error paths.
Accounting remains **176 selected / 33 deferred**. This is an upstream call
contract, not a claim that arbitrary delegated child values are statically checked.


### Collection read projection safeguards

All five actual collection repository documents (profile, both public sensitivity
modes, owned share target and channel identity) execute through the schema in a
projection-drift test. Selected paths must exactly match their generated-schema
projection declarations. The same test preserves filters, sort/limit/offset and
age-eligibility context; disposable-database repository tests cover actual reads.
Share snapshots now require the selected nullable description/creator and the
schema visibility enum rather than optional catch-all properties. Negative type
fixtures reject missing selected fields, invalid enums and unfetched child fields.
This does not certify arbitrary outer Collection child selections or change
profile filter composition. Accounting remains **176 selected / 33 deferred**.


### Collection read authorization regression

A reproduced profile-filter authorization defect is fixed by intersecting caller
filters with the profile/visibility scope. Generated Collection READ/AGGREGATE
filters independently restrict roots, relationship reads and counts to public
collections or the verified graph owner. Internal profile and owned-share reads
forward only the already-resolved viewer identity; public reads remain anonymous.
The profile resolver accepts the generated sort/limit/offset arguments, retaining
default ordering and the library's zero-limit semantics. Real GraphQL + Shield +
disposable-Neo4j tests cover owner, visitor and anonymous access, nested Boolean
filters, relationships, aliases/fragments, pagination, aggregate counts and the
existing denial on User.CollectionsConnection. This is read protection, not a
change to collection writes or a certification of subscription event delivery.
The selected-response inventory remains **176 selected / 33 deferred**.


The pass-through registration guard also binds each fallback's explicit source
field to its registered GraphQL field, preventing a validly typed list helper
from silently reading a different relationship. This proves name alignment only;
aliased response-key handling and deferred child completion are unchanged.


### Bot provisioning source projections

Bot identity and channel-bot repositories now expose exact generated selections
rather than complete User/Channel/ServerConfig objects. The service preserves its
distinct existing-identity and created-user response shapes, and middleware no
longer casts server-plugin edges to an optional-property catch-all. Ten repository
entry paths exercise nine actual documents through the schema, including default
write projections and the delegated orphan disconnect. Compile-negative fixtures
reject missing selected nullable fields, unsafe nullable Plugin access and unfetched
user/channel relationships. Real GraphQL + Shield tests cover owner provisioning,
repeat mutations, aliases/fragments and denial before anonymous/non-owner writes.
Existing disposable-database tests retain sequential synchronization, the 25-bot
read limit, stale original identity after reactivation, and post-commit projection
failure ordering. No query, write, setting normalization or permission behavior is
changed. JSON contents and dynamically requested Channel.Bots child fields remain
outside this fixed-source guarantee; accounting stays **176 selected / 33 deferred**.


The owned bot-comment write likewise no longer casts its scalar map to an entire
Comment. Its record/source types guarantee the randomUUID identity written by the
query and retain unknown caller/persisted leaves; no relationship objects are
invented. Compile-negative fixtures reject treating the source as a full Comment
or assuming caller text is validated. Real-schema completion tests preserve valid
selected scalars, absent relationship projections and lazy nullable errors for
malformed selected text. Existing ancestry/order/error/empty-result tests remain;
this does not add a nonempty-result guarantee or change the write transaction.


Bot-report lookups now use their five exact fixed projections, including required
`__typename` and distinct nullable User/ModerationProfile author branches. The
created-issue adapter retains the owned writer's actual source type instead of a
whole-Issue cast. Executable schema comparisons preserve the union branches; the
existing real-database report tests cover user/moderator authors, missing targets,
new/existing reports, literal filters, idempotency/order and unchanged side effects.
The append adapter now also retains the owned writer's actual source type. The
bot API returns the number already validated by the issue read, or the locally
allocated number for a new issue, rather than the raw append leaf. A real-schema
regression rejects the old string-number mismatch while proving stored text and
append side effects are unchanged. No post-commit number validation, extra read,
or write/authorization policy is introduced; idempotent replay and other response
fields are preserved.

### Pipeline executor source projections

Channel and comment executors now consume exact fixed schema projections for
channels, content, configuration, pending/returned jobs and secrets instead of
whole generated entities. The comment author retains its two distinct selected
branches without inventing a discriminator. The current discussion read guarantees
its plural attachment selection; the injected-adapter interface explicitly retains
the pre-existing singular attachment fallback. Neither shape is a full file entity.
All fifteen actual repository documents execute through the schema in a drift test,
including mutation default selections, filter ordering and the one-file limit.
Removing the moderator's selected display name makes that test fail. Compile-negative
fixtures reject full-entity assignments, unselected mutation info/lease fields and
unsafe author assumptions. Existing disposable-database and executor tests preserve
write/event ordering, post-commit projection failures, retries, stale revisions and
settings precedence. No query, permission, worker pause or persistence behavior is
changed. JSON leaves and dynamic outer response children remain outside these fixed
source guarantees; inventory remains **176 selected / 33 deferred**.


### Event-series deletion source projection

The deletion repository now exposes only its selected event identity, title,
occurrence index and nested series/occurrence fields. It no longer claims a full
Event result. The resolver consumes that projection directly, and compile-negative
fixtures reject unselected child titles, missing selected nullable indices and
unsafe nullable series access. A schema-executed drift test guards the snapshot
and both native delete response documents. Removing the nested occurrence index
fails that guard. Real database tests retain standalone/missing events, each scope,
the existing 25-occurrence nested default, sequential deletion and partial commit
on a later projection failure. Existing GraphQL response tests retain selected
success/count/message completion. This adds no batching, pagination, transaction
or permission policy; the selected response count remains **176 / 209**, with
**33 deferred**.

### Content-validation source projections

The four content-validation reads now derive exact source shapes from generated
schema types. Discussion-channel membership is a required selected list with
required identities, rather than an optional-property catch-all. File checks
remain limited to id/name; emoji checks retain selected nullable channel links,
lock/archive states and unrestricted JSON leaves. Executable comparisons guard
all four actual documents. Removing the discussion lock selection is rejected.
Compile-negative fixtures reject absent selected relationships/identities and
unselected content/upload fields. Existing graph and permission tests preserve
anonymous reads, noninheritance of privileged outer context, nested filtering,
missing records and settings behavior. This is source precision only: no input,
authorization, default, JSON validation or write behavior changes, and accounting
remains **176 selected / 33 deferred**.

### Pipeline lifecycle payloads

Attempt creation and lease updates now expose the rows actually selected by their
schema-executed documents, without inventing an `info` member or unselected job
fields. The job projection is shared with executor reads; attempt default fields
and prior attempt numbers have generated projections. Eleven actual documents
are checked through executable GraphQL, and removal of the lease identity selection
fails the drift test. Compile-negative fixtures reject invented mutation metadata
and absent selected fields. Existing disposable-database and lifecycle tests cover
claims, ownership, renewal, rescheduling, completion, rate/concurrency limits and
post-commit projection failures. Raw event claims still return their existing
string-converted identity; no transition, scheduling or pause policy changes.
Accounting remains **176 selected / 33 deferred**.

### Notification source projections and nullable-text delivery

All ten notification read paths now declare exact selected recipient preferences,
email links, content links and User/ModerationProfile branches, instead of complete
nested User/Comment entities. Only queries that select `__typename` guarantee that
discriminator. The entry point no longer casts author data; feedback and mention
helpers consume the precise snapshot, preserving their existing undefined/null
fallbacks. Executable selection comparisons and compile-negative fixtures protect
these boundaries, including nested reply preferences and absent email fields.
Existing graph tests retain recipient exclusion, preference filtering, permission
filters, default limits and successful discussion/event/reply notification writes.
Delivery regressions capture fake provider requests and block real HTTP requests;
no messages leave the disposable test environment.

The newly reproduced null-text consumer defect is now fixed with the authorized
empty-excerpt policy. Discussion, event and reply paths normalize nullable text
only at email-content creation; stored comment text, recipients, authorization,
notification formats and non-null Markdown rendering are unchanged. All six
notification helpers now consume the precise comment projection. Real-database
regressions cover null/non-null text, self-exclusion, reply opt-out, captured email
content and unchanged persisted text. Restoring the old handler makes all three
null-text delivery regressions fail while non-null controls still pass. The direct
renderer contract still requires a string, protected by a compile-negative fixture.
Accounting remains **176 / 209 selected, 33 deferred**; this fixes the concrete
consumer defect without claiming arbitrary nested operation correctness.


### Notification-delivery projections

Pipeline-result delivery now uses exact attempt/file projections and removes the
whole-file intersection cast from recipient/link selection. Email recipient reads
reuse the required selected username/email projection. Six schema-executed document
checks protect these reads and the default user selections after pipeline, email
and general notification writes; an omitted archived-channel field is rejected.
Existing graph tests preserve canonical author fallback, archived-only null links,
concurrent single delivery, retry rollback and post-commit projection failures.
Email ordering, duplicate notifications and the historical omitted notification
type remain unchanged. These are source and query safeguards, not a new delivery
policy or certification of arbitrary user fields. Counts remain **176 selected /
33 deferred**.

### Permission request-cache boundary

The request cache retains `PermissionServerConfig | null` instead of erasing the
repository result to `any`. Membership mapping now preserves nullable identities,
and channel permission consumers use the declared snapshot directly without
unknown-to-role casts. Missing server defaults remain nullable and keep existing
fallback behavior. Compile fixtures reject reintroducing `any`, unselected plugin
fields and non-null identity assumptions. Focused tests preserve pending/null/error
memoization and request isolation; real GraphQL + Shield tests prove nullable
persisted membership identities do not grant server privileges. This does not
validate raw stored capability values, alter role precedence or change any
permission decision. The repository's raw projection limitations remain explicit;
accounting stays **176 selected / 33 deferred**.

The native suspension-notification writer now types its result row from the
query's three literal CASE outcomes and keeps `user-not-found` as the absent-row
fallback, removing the final result cast. Compile fixtures distinguish returned
rows from that fallback. Existing disposable-database tests cover all outcomes,
opt-out, repeated unread/read notifications, target-specific cleanup and valid
issue links. No stored property is relabeled as validated data, and no notification
or suspension behavior changes.

### Native channel authorization source

Channel authorization reads now distinguish Cypher-constructed containers from
unvalidated stored leaves. Capability and identity values remain `unknown` through
normalization instead of being asserted to be Boolean/string values. The snapshot
adapter explicitly preserves the query's role/member containers and existing
recursive integer normalization; the injected-adapter compatibility shape remains
supported. Owner/default/moderator decision helpers retain exact-true comparisons.
Compile fixtures reject Boolean/string assumptions, while real GraphQL + Shield
mutations prove stored `"true"`, `1` and `false` cannot create a discussion and
Boolean `true` can. Existing owner, moderator, lock, suspension and cleanup tests
remain unchanged in behavior. The server and suspension source follow-ups below now cover their native
containers too; stored scalar leaves remain explicitly untrusted. Role precedence,
lock truthiness and permission policy are unchanged. Counts remain **176 selected /
33 deferred**.

### Native server authorization source

The native server-config query now declares its constructed role/membership
containers without pretending stored capability flags or member identities have
passed GraphQL scalar completion. Raw leaves remain `unknown` through the request
cache, role-tier selection, membership checks and no-escalation consumers. Existing
strict Boolean comparisons, exact identity comparisons, root/tier/suspension
precedence, leader routing and recursive Neo4j integer normalization are unchanged.
The download feature flag also remains untrusted until its existing `=== true`
check. Compile-negative coverage prevents reintroducing trusted leaf assertions;
a real GraphQL/Shield mutation checks string, numeric, false, null and true stored
capabilities against a disposable database. Nested suspension source conversion is covered by the follow-up below, with
stored leaves explicitly untrusted. These source safeguards do not increase the
selected response-boundary count or certify the whole authorization system.

### Instance age/feature policy source selections

The two native policy reads now select distinct, required property-map contracts
instead of casting both results to an open dictionary. Native leaf values remain
unknown until the existing GraphQL Boolean/Int/String conversions run. The concrete
repository exposes the completed nullable fields; injected reader interfaces keep
their existing optional-key compatibility. Actual Cypher selection keys are checked
against the source declarations, alongside compile-negative checks and disposable
Neo4j regressions for nulls, numeric conversions, malformed values, multiple configs,
missing names and defaults. Routing, bookmarks, ordering, scalar coercion, error
behavior and age/feature policy are unchanged. This strengthens an upstream read;
it does not promote any of the 33 deferred outer response boundaries.


### Scratchpad moderator author regression

The source query now selects both supported author branches. Previously a valid
ModerationProfile author was misclassified as User and failed username completion
before creating the entry. Tests execute the mutation through GraphQL and Shield,
checking the response, vote weight, notification recipient, no moderator-author
user karma, ordinary User-author karma, repeated operations, missing normal votes
and unauthorized callers. Restoring the old document makes the positive moderator
test fail. No recipient selection, permission or karma policy changes are made;
the existing documented moderator no-karma path is now reachable. The projection
and compile-negative fixtures distinguish both branches. The raw returned
super-upvoter child properties remain deferred, so counts do not increase.

### Targeted server-suspension source

The two native targeted suspension reads now have separate user/moderator source
shapes instead of casting their results to complete generated Suspensions. Cypher
provides the nullable date string; other stored leaves remain unknown through
normalization, request caching, expiry classification, cleanup ID lists and
notification formatting. Compile-negative fixtures reject treating raw IDs, flags
or issue numbers as completed scalars. Real GraphQL/Shield and disposable-database
tests retain suspension precedence, including legacy truthy non-Boolean flags,
plus expiry, notification and cleanup behavior. Read routing, sequential queries,
cache identity and transaction boundaries are unchanged. The server configuration lists and channel suspension source are covered in
the next section. No selected-response inventory promotion is made.

### Channel and configuration suspension sources

Targeted channel user/moderator reads now declare their distinct native map shapes,
with no unrestricted normalization return or whole-entity assertion. Issue and
identity values remain unknown through classification and cleanup. Server-config
suspension lists now use an exact native selection too, replacing their legacy
unrestricted conversion. Existing injected-reader compatibility remains explicit.
This completes the previously noted native permission-source gap, not a promise
that arbitrary stored scalars are valid. Compile-negative and real-database tests
retain numeric identity values, string issue numbers, nullable links and existing
indefinite-flag truthiness; GraphQL/Shield enforcement and notification regressions
cover the downstream paths. No suspension policy, scope, routing, cleanup order,
public schema or selected-response inventory count changes are introduced.

Five actual native suspension queries additionally execute against a disposable
Neo4j with their returned map keys checked against the source declarations,
including nested issue/member projections and null-valued selected keys. Removing
a required selection fails the guard; restoring it passes. This guards query/type
drift without adding eager scalar rejection to production reads.


### Super-vote source and undo regression

Permission checks now resolve the persisted source for both supported content
kinds. GraphQL/Shield regressions verify source permissions and suspensions,
unchanged vote/karma/scratchpad state on denied mutations, and permitted create/undo
flows. The undo source query now selects both author union branches as creation
does; restoring its old projection reproduces the moderator-author failure.
Ordinary author karma, moderator no-karma behavior, notification preferences,
limits and transaction ordering remain intact. This behavior correction does not
certify the raw returned voter list or change selected-response accounting.

### Voting actor checks

The two shared vote/reaction permission guards now require the supplied username
to match the authenticated request identity. Identity resolution uses the existing
request cache, including when Shield evaluates sibling rules concurrently. Tests
execute all eight add/remove operations through GraphQL and Shield, verifying
rejection before content lookup and no vote, reaction, weight, karma or notification
changes on denial. Each operation also has a successful self-action control.
Required-argument validation, channel permissions, response contracts and ordinary
voting/reaction behavior remain intact. No additional response boundary is counted.

Voting permission-cache entries are scoped to mutation arguments. Batched GraphQL
regressions check independent aliases in both authorization orders, including
source-specific super-votes. The earlier context-only cache fails those tests;
argument-scoped entries preserve both legitimate operations and denied-state
integrity. This is confined to the three voting guards; unrelated permission-rule
caching is not certified by these tests.

### Native ownership source projections

The shared content-authorization repository now declares its exact native query
columns and keeps unvalidated property leaves as `unknown`. Owner identifiers,
user/moderator identities and legacy issue-lock values retain their existing
null fallback, equality and truthiness semantics; no scalar coercion is added.
Compile-negative fixtures prevent these raw values being mistaken for completed
GraphQL scalars. Disposable-database tests compare all eight actual query column
sets with their source types, and removing a required author column fails the
check. GraphQL/Shield regressions retain denial for malformed ownership and
legacy truthy lock values. These are source guarantees, not new certifications
of outer response children: accounting remains **176 selected / 33 deferred**.

### Channel authorization lookup columns

All six native content-to-channel queries now have explicit row types, including
Boolean existence expressions and raw channel-name properties. The shared
single-record adapter accepts only selected column names. Existing normalization
continues to discard non-string and empty channel names and deduplicate lists;
no permission, routing, null or failure behavior changes. Compile-negative tests
separate raw from normalized values, and real database checks guard the actual
query columns and malformed-value normalization. Renaming a required column fails
the guard. This source work does not change outer response inventory counts.

### Role authorization read projections

Role-guard reads now declare their fixed owner, administrator and capability
selections against generated schema types. Selected owner keys are required
(while nullable owners remain nullable), and server/moderator capability results
have distinct complete field sets instead of arbitrary sparse dictionaries.
An executable schema check compares all five actual repository documents with
those selections; removing a guarded capability fails the check. Real database
regressions cover nullable owners/flags, filters and rejected malformed scalar
leaves. No source read behavior or outer response inventory count changes.

### Moderator-edit input compatibility

Comment, discussion and event moderator checks now consume the generated ID
filter shape (`eq` and bounded `in`) as well as the existing legacy identifiers.
Compile checks bind the handlers to generated mutation arguments. Single-owner
checks do not authorize batches; for bounded lists they allow the alternative
moderator check to evaluate every candidate channel. Missing-ID errors and
single-owner behavior remain intact. Real GraphQL/Shield/database tests cover
permitted edits, denied targets, authors, anonymous callers, missing records,
active suspensions and application-owned discussion/event update operations.
This input/permission correction does not promote deferred response children.

The event application-owned update still requires explicit connection and
disconnection arrays at runtime. Omitted or null lists retain the existing
transactional `not iterable` rejection, even though the schema admits them.
The moderator regression supplies empty lists for its successful update and
separately verifies rollback for omitted/null lists. This slice does not choose
new null/omission semantics; accepting those inputs as no changes remains a
separate behavior decision.

### Selection-aware account child identity pilot

The generated `Query.users` source now adds an internal username dependency only
when an owner-protected User field is selected. The dependency uses a collision-free
response alias and is retained in a private weak map for the account ownership rule;
it is not part of the caller's response. The dependency field list is checked against
the actual permission registrations. Fragment spreads, merged field nodes, aliases,
and variable/default `skip` and `include` directives retain their GraphQL meaning.

Raw identity stays `unknown` until the existing ownership comparison. Other child
values remain lazy: the adapter neither validates unrequested children nor converts
nullable errors into whole-object failures. Real schema, Shield and disposable graph
tests cover owner/non-owner/anonymous results and requested-field error paths.
Removing the adapter makes three of the initial nine pilot regressions fail;
additional cases cover active directives, empty matches and pagination.

This is a source dependency guarantee for `Query.users`, not certification of all
User-producing operations or arbitrary child projections. The inventory remains
176 selected-response entries and 33 deferred entries.

The same `Query.users` dependency now covers the custom `User.Collections` reader.
That reader requires a nonempty string source identity before constructing its
profile filter, and keeps the existing visibility/filter intersection and pagination.
Real graph tests cover omitted identity selections, fragments, aliases, skipped
fields, and owner/visitor/anonymous results. Invalid or unavailable source identity
is an explicit field error rather than an unscoped repository read. User sources
outside this pilot still need their own selection-dependency coverage; they are not
marked complete by this change.

Account ownership comparisons now run for every field/operation without hashing
the parent object. Shield's default strict-cache hash throws when it encounters a
Neo4j Integer constructor, before the permission comparison can run. Three real
GraphQL regressions fail with strict hashing and pass with per-field comparison:
valid integer sibling fields in both result orders, and a malformed integer-array
sibling whose completion error must stay on that sibling. Authentication continues
to use the existing request cache; ownership results are never reused across
parents or mutation arguments. This changes neither visibility policy nor schema.

The dependency adapter also covers selected User children of generated
`Mutation.updateUsers` responses. It rewrites the executed selection and captures
the resulting raw identity without re-running the mutation. Real graph tests cover
ordinary/aliased response lists, User fragments, denied writes, empty matches and
skipped private fields. A pre-fix probe reproduced a child ownership error after a
successful owner update; the new dependency removes that response error while
preserving write timing. This does not certify every generated mutation selection
shape, custom User-producing source, or child value. Inventory counts are unchanged.

### User connection source dependency

`Query.usersConnection` now supplies identity through the explicit `edges.node`
source path. The path adapter records actual response aliases for ordinary
projections, while the Neo4j root connection registration declares its canonical
internal `edges`/`node` keys. It does not guess between the two representations.
The original users read and update-response adapters retain their existing paths.
Real graph tests cover owner and anonymous results, private-field denial, aliased
edges/nodes, fragments and directive variables, cursor pagination and empty pages.
This adds a verified source dependency, not a full User/connection child contract;
the selected/deferred inventory is unchanged.

The next source registrations are `Query.collections → CreatedBy` and
`Query.collectionsConnection → edges.node.CreatedBy`. Key conventions are declared
per segment: canonical connection envelopes followed by response-key projections.
Actual graph tests cover both source representations, aliased nullable creators,
owner/visitor/anonymous child permissions, visibility-filtered connections, skipped
fields and local scalar completion errors. A two-case pre-fix probe failed for
owner Email reads without a selected username. The dependency fixes those reads
without changing collection visibility or certifying all descendant User values.
Inventory counts remain unchanged.

Generated `channels` and `channelsConnection` now declare User source paths for
`Admins`, `Bots`, `PendingOwnerInvites` and `PendingModInvites`. The multi-path
adapter executes the source once and only adds dependencies to selections that
request a protected child or profile collections. It preserves the pass-through
list resolver's existing behavior. Real graph tests exercise each list, mixed
aliases/fragments, owner and anonymous denial, independent filters, skipped fields,
and empty results. These source paths do not certify opaque list items or promote
inventory entries. The relation-sort regression found during this work is addressed
by the following bounded dependency patch.


### Relation ordering before response aliases

The version-pinned `@neo4j/graphql@7.6.4` patch sorts nested reads by original
stored/computed values before projecting response aliases. Previously an alias
such as `username: bio` could make a username sort order by the biography instead,
and computed sort projections could overwrite a requested response alias. The
patch preserves implicit sort fields, existing filtering and pagination, and the
unsorted projection path. It changes neither the schema nor authorization rules.

Ten disposable-database regressions cover ascending/descending and multi-key
ordering, nullable values, database property aliases, computed fields, omitted
sort selections, independent relation aliases, filters/pagination, nested mutation
responses and generated authorization filters. The initial eight cases all failed
before the patch. Three application regressions verify channel member ordering
and pagination with real Shield child permissions. Upgrade work must re-evaluate
this version-specific patch and retain the executable regressions; the dependency
version and patch hash are locked by pnpm and included in container builds.

This fixes concrete ordering/response behavior, not arbitrary descendant value
contracts. Accounting remains **176 selected / 33 deferred**.

Server-config roots now declare the four User-list source paths `SuperAdmins`,
`Admins`, `PendingAdminInvites` and `PendingModInvites`, including their generated
connection envelopes. Four pre-fix owner Email probes failed without username in
the selection. Nine real graph/Shield regressions cover owner and anonymous
results, aliases/fragments, sorted members, skipped dependencies, missing servers,
empty lists and requested scalar errors. This preserves administrative capabilities
and does not certify whole User children; accounting stays 176 selected / 33 deferred.

Generated image and album roots now supply identity through `Image.Uploader`,
`Image.PermanentlyRemovedByUser` and `Album.Owner`, for ordinary lists and root
connections. Three owner-read probes failed before registration; 20 real
schema/Shield/database regressions now cover aliases/fragments, owner/anonymous
permissions, nullable relationships, omitted and skipped selections, empty results,
local scalar failures and sensitive-image filtering. These explicit paths do not
extend to arbitrary nested asset relationships or certify full returned User
objects. Accounting remains 176 selected / 33 deferred.

`moderationProfiles` and its root connection now declare only the computed
`BotUser` source dependency. The initial owner Email probe failed without selected
username. Nine real graph/Shield tests exercise computed sources, both root
representations, aliases/fragments/directives, bot owner/other/anonymous callers,
human and missing-account nulls, and local scalar errors. The separate `User` edge
is still denied even to the account owner; no human moderator identity dependency
is added or exposed. These checks do not certify arbitrary moderator descendants
or full User values; accounting remains 176 selected / 33 deferred.

Generated wiki-page roots now declare `OriginalAuthor` and `VersionAuthor`;
text-version roots declare `Author`; label-change-history roots declare `ActorUser`.
Root connections use the same explicit paths with canonical connection envelopes.
All four pre-fix owner-child probes failed without selected username. The 26
real graph/Shield regressions cover both source representations, owner/anonymous
permissions, caller aliases and fragments, directive variables, null attribution,
missing records, selected scalar failures and sensitive-text filtering. This does
not certify arbitrary descendants, custom content-list sources or complete User
objects. Accounting remains 176 selected / 33 deferred.

Discussion author/body-editor and event poster/description-editor sources now
carry protected-child identity through their generated lists and root connections;
event-series posters use the same explicit boundary. Five pre-fix probes failed
without username selection. The 32 real graph/Shield regressions preserve aliases,
fragments, directives, owner/anonymous permissions, null attribution, missing
records, local scalar errors and sensitive-discussion filtering. Event-channel
omission/null behavior is untouched. These source guarantees do not certify all
content children; accounting remains 176 selected / 33 deferred.

### Explicit comment and issue author union sources

Public `comments` / `issues` lists and their root connections now select private,
collision-free fields in the User and ModerationProfile branches. Presence of one
branch establishes the discriminator in a WeakMap; public aliases, nullable names
and malformed unrequested names cannot select the type. User identity remains raw
until the ownership rule validates it. Missing or ambiguous branch markers produce
a GraphQL type error rather than falling back to a caller-controlled property.

An isolated checkout before this change fails all four initial probes: two owner
Email requests without username and two moderator authors without displayName.
The 21 real graph/Shield regressions now cover both root representations, mixed
authors, aliases/fragments/directives, owner/other/anonymous callers, nullable
authors/names, selected scalar failures, age filtering and the always-denied
human moderator User edge. Two unit regressions cover malformed/ambiguous markers,
alias reservation and skipped unions; compile-negative fixtures reject arbitrary
union registrations and discriminator names.

These guarantees apply only to the four registered public roots. Unregistered
internal/generated repository calls and custom/nested author sources retain their
legacy behavior, including the separate scratchpad-source limitation documented
above. No public schema, write behavior, event-channel policy or worker-pause
policy changes. Accounting remains **176 selected / 33 deferred**.

### Internal author reads and nullable moderator names

Named scratchpad moderator authors were already fixed in `59c370b`; the remaining
reproduced failure was a nullable moderator display name. Three new probes failed
before this slice: omitted-name internal comment/issue author reads and the null-name
scratchpad source. Internal execution now has a separate schema view that records
Neo4j's own literal to-one union type metadata at four explicit comment/issue roots.
The original raw schema accessor, exact domain-owned selections, variable coercion,
transaction/JWT context, database filters and first-error propagation are unchanged.
No Shield or request identity is added to internal execution. Public sources keep
their separate private-branch selection checks.

Real graph regressions cover internal list/connection aliases, fragments, skipped
fields and pagination. The exact scratchpad projection guard still passes without
relaxation. Actual GraphQL/Shield mutation tests now cover both named and null-name
moderator authors, unchanged notifications/karma, repeat operations and denials.
Unit checks cover metadata domain validation, absent markers, context isolation,
unchanged documents and the untouched raw-schema accessor. The metadata adapter is
limited to the pinned Neo4j to-one author projection: it does not certify arbitrary
custom parent properties, relationship connections or other nested paths. Existing
schema-owned nullable names remain nullable; inventory stays 176 selected / 33 deferred.

### One-hop reply author sources

The explicit comment author path set now also includes `ParentComment.CommentAuthor`
and `ChildComments.CommentAuthor`, for public and fixed internal comment lists and
root connections. The two pre-fix probes reproduced a wrongly typed parent moderator
and an owner Email denial on a child author. Sixteen graph/Shield regressions cover
both representations, mixed authors, aliases/fragments/directives, owner/other/
anonymous access, the forbidden moderator User edge, filtering/pagination, empty
or absent relationships, age filtering, local scalar errors and the unchanged
25-child default limit. Internal reads retain generated type metadata and exact
selections; the original raw schema and its root resolver remain unchanged.

This is one explicit parent/child hop, not recursive certification. Deeper reply
trees, mutation responses and unrelated custom/nested sources remain outside the
path set. Inventory remains **176 selected / 33 deferred**; both pending product
policies and the public schema are unchanged.
