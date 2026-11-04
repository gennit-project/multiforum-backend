# Remaining response-contract decisions after #448

This is an investigation checkpoint, not approval to change behavior. The campaign
has 173 selected response/source boundaries and 36 deferred entries. The three
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
No extra inventory entries are promoted; accounting remains 173 selected / 36 deferred.

## Remaining race choices and merged discussion/share decisions

| Operations | Current boundary | Proposed choice and tradeoff |
| --- | --- | --- |
| `createEventWithChannelConnections` | Each event's generated create, tags and channel writes share `executeWrite`; response refetch happens after commit. Errors inside the per-item block are logged/swallowed and the loop continues. | Return the existing response projection read inside that same transaction after owned writes. This closes the post-commit disappearance gap, but moves projection failure before commit: explicitly approve rollback on projection failure and preserve per-item batch semantics. |
| `createDiscussionWithChannelConnections` | Ordinary creation is fixed by #447/#448: owned writes and fixed response validation share the item transaction; plugins run after commit. | No outstanding ordinary-create race decision. Crossposts remain a separate branch; precise shared-helper/result typing is unfinished. Outer GraphQL completion and delivery remain after commit. |
| `shareCollectionAsDiscussion` | Uses the same transactionally captured ordinary creation result from #448. Missing/mismatched internal projections roll back. | The prior response-read race is fixed. A nonempty ordinary-create type and actual wrapper boundary still need proof; no full-operation certification is claimed. |
| `pausePluginPipelineCampaign`, `resumePluginPipelineCampaign` | Authenticated plugin-manager gate; status lookup validates transition, then a separate update matches only ID. Disappearance returns undefined for a non-null root; a concurrent status change can also invalidate the earlier decision. | Atomically match ID plus expected state and update. Return `NOT_FOUND` for a missing campaign and `BAD_USER_INPUT` for a conflicting transition, with a deliberate transaction/locking strategy for distinguishing them. Preserve plugin-manager permission checks; do not silently overwrite a concurrent state based on stale validation. |

Source evidence: the two create helpers, collection-share resolver,
`pluginPipelineCampaigns.ts`, `campaignControlRepository.ts`, and their existing
real-driver regressions. Only event creation and campaign pause/resume retain the race choices above.
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
