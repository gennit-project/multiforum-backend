# Remaining response-contract decisions after #450

This is an investigation checkpoint, not approval to change behavior. The campaign
has 176 selected response/source boundaries and 33 deferred entries. The three
variant URL fields also enforce an application-owned string-map-or-null domain;
they remain deferred for generated JSON structural guarantees. Selected boundaries
still leave documented raw residual fields.

## Fixed download graph reads

Merged #441 corrects upload inventory channel traversal and review author fallback.
The existing three graph witnesses now pass with canonical values, alongside nine
permission/filter/order regressions from #441. Explicit nested raw projections
replace fictitious full strings: only the upload username predicate and review
status filter prove selected scalar values. Unrequested malformed titles and file
names remain lazy; aliases/fragments preserve these read results and requested
malformed fields fail at the correct response path.

## Selection fixes and source-boundary guarantees

Merged #443 fixes bot-list alias lookup and delegates activity payload reads through
GraphQL. The old failure witnesses now assert correct results. Real schema/Shield
tests cover independent filtered aliases, nested/payload fragments, merged field
nodes, directive/argument variables and defaults, skipped fields, nullable errors,
private identities, denied callers and a single action/comment write per mutation.

All 23 pass-through list registrations now enforce generated call signatures and
list-container nullability via `OpaqueListSource`. Items remain unknown, so these
are NOT promoted to checked selected-response entries. Unrestricted JSON cannot
masquerade as a list contract. The activity registration checks the generated root
arguments and the actual child method `(args, context, info)` convention; the
delegation result is explicitly unknown rather than asserted as a full Issue list.
Compile-negative tests and AST drift guards enforce these separate source checks.

The remaining item-contract work must model each upstream selection, preserving
response keys, variables and child completion. A generic full-entity cast or eager
row decoder is not equivalent to field-level GraphQL behavior. Runtime regression
coverage establishes behavior but does not manufacture static item guarantees.

Image-usage reads retain exact nested raw projections without the whole-result
cast. Merged #444 fixes canonical discussion-channel traversal. All 16 focused
source/traversal tests pass, including real Shield behavior, public nonsensitive
reads, private nested denial, resolved sensitive eligibility and alias/fragment
paths. This fixes the observed omission without certifying raw child properties.

## Fixed upstream projection drift checks

`pipelineProjectionContracts.test.ts` invokes all ten actual start/rerun repository
read methods through the generated executable schema. Only the root data source is
replaced with an empty list; no database is used by this guard. GraphQL validates
the actual documents/variables, and the root resolve info records exact response
paths for comparison with the generated-type-derived declarations. Existing real
Neo4j repository and pipeline execution tests provide the persistence evidence.
Removing selected title from the executed discussion query makes the guard fail.

The reusable test helper preserves aliases, same-object fragments and merged
selections. It rejects directives and narrowed/abstract fragments that would need
an explicit optional/union projection rather than flattening them into required
fields. JSON remains a scalar leaf; the guard does not prove its internal domain.
This ties fixed upstream declarations to executed selections but does not remove
the trusted generic execution adapter or certify arbitrary dynamic child values.
That earlier pipeline guard did not promote entries. After #449, event creation adds one checked selected boundary: 175 selected / 34 deferred.

## Remaining race choices and merged discussion/share decisions

| Operations | Current boundary | Proposed choice and tradeoff |
| --- | --- | --- |
| `createEventWithChannelConnections` | Fixed by merged #449: validate the response in the item transaction and omit rolled-back failures while continuing the batch. | Successful selected projections are now checked at the actual resolver registration. Outer GraphQL completion/delivery remain after commit. |
| `createDiscussionWithChannelConnections` | Ordinary creation is fixed by #447/#448: owned writes and fixed response validation share the item transaction; plugins run after commit. | No outstanding ordinary-create race decision. Crosspost responses are guarded by #450 and successful elements now have checked types. Outer GraphQL completion and delivery remain after commit. |
| `shareCollectionAsDiscussion` | Uses the same transactionally captured ordinary creation result from #448. Missing/mismatched internal projections roll back. | The prior response-read race is fixed. The nonempty result and actual wrapper boundary are now checked (see below); no full-operation certification is claimed. |
| `pausePluginPipelineCampaign`, `resumePluginPipelineCampaign` | Authenticated plugin-manager gate; status lookup validates transition, then a separate update matches only ID. Disappearance returns undefined for a non-null root; a concurrent status change can also invalidate the earlier decision. | Atomically match ID plus expected state and update. Return `NOT_FOUND` for a missing campaign and `BAD_USER_INPUT` for a conflicting transition, with a deliberate transaction/locking strategy for distinguishing them. Preserve plugin-manager permission checks; do not silently overwrite a concurrent state based on stale validation. |

Source evidence: the two create helpers, collection-share resolver,
`pluginPipelineCampaigns.ts`, `campaignControlRepository.ts`, and their existing
real-driver regressions. Only campaign pause/resume retain the race choices above.
The proposal is per-item, not whole-batch atomicity, and does not claim that an
already-returned snapshot prevents a later deletion or permission change.

## Separate deterministic fixes to coordinate

1. `startPluginPipeline` and `rerunPluginPipeline` Discussion-target behavior was
   fixed in merged #442. Supported plural attachment selections and current/legacy
   content hashes are retained. Precise generated projections and execution tests
   now cover these successful paths; first-attachment policy is unchanged.
2. Image/profile/icon variant persistence is fixed by merged #445: compatible JSON
   text storage, map/legacy scalar normalization and aliases are covered by real-schema
   regressions. Generated JSON remains unrestricted; domain checks are separate.
3. Image-usage traversal is fixed in #444. The list-alias and dynamic-selection
   bugs were fixed in #443; opaque child types still require precise upstream
   contracts, rather than another behavior fix.

No extra PR is created by this checkpoint. Coordinate the behavior fixes separately
from #419; no merge/deployment/shared database writes or schema/permission changes.

## Executed creation projection guards

`creationProjectionContracts.test.ts` executes all four actual discussion/event
create and response-read documents through the real generated schema. Empty root
containers isolate selection shape; a real disposable managed transaction preserves
the repository interface. Exact response paths are compared with the generated-type
derived declarations. This does not certify arbitrary rows or the generic adapter.
Event successful results exclude undefined because #449 guards them before commit;
compile-negative fixtures reject incomplete selected results. Discussion is now checked after #450. Sharing now consumes the checked nonempty ordinary-create contract described below.
No cast is used to make the wrapper appear complete.

Failure experiments confirmed both guards: removing `title` from the actual
discussion selection fails the executable comparison at `discussions.title`;
changing the successful event projection ID to a number fails TypeScript at the
actual mutation registration. Both deliberate changes were restored.

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

Fault-injection checks rejected both an added `title` in the ID-only create query
and a removed `title` in the shared response selection. Both failed the actual
response-path comparison; the changes were restored before final validation.

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

Recommended decision: preserve terminal completion/cancellation, serialize the
expected-state check with the write, return `NOT_FOUND` for disappearance and
`BAD_USER_INPUT` for a changed state. Preserve existing manager permissions and
explicitly retain the existing treatment of already-running provider jobs; stopping
in-flight work is a different pause policy. A transaction alone is insufficient
if the status predicate is evaluated before acquiring the write lock. The future
fix needs real competing-transaction tests and validation before commit. The
alternative is to retain last-writer-wins behavior, accepting the observed terminal
state overwrite. This behavior choice requires approval before implementation.
