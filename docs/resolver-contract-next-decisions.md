# Remaining response-contract decisions after #443

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

Image-usage reads also now have exact nested raw projections, without the previous
whole-result cast. A new canonical-graph witness finds that this query still follows
the reversed discussion-channel edge (a separate occurrence from #441). The same omission is reproduced through actual public Shield middleware for a
nonsensitive image. Query wildcard allow permits that read; the sensitive-content
filter still rejects a resolved ineligible caller. These tests inject the resolved
age-policy decision rather than re-testing the policy engine. A graph traversal
fix must be coordinated separately. No permission or query change is included.

## Five race cases: choices requiring approval

| Operations | Current boundary | Proposed choice and tradeoff |
| --- | --- | --- |
| `createEventWithChannelConnections` | Each event's generated create, tags and channel writes share `executeWrite`; response refetch happens after commit. Errors inside the per-item block are logged/swallowed and the loop continues. | Return the existing response projection read inside that same transaction after owned writes. This closes the post-commit disappearance gap, but moves projection failure before commit: explicitly approve rollback on projection failure and preserve per-item batch semantics. |
| `createDiscussionWithChannelConnections` | Generated creation, author/collection edges, tags, album ownership and channel writes use multiple committed steps; plugin triggers run before the final separate refetch. Existing crosspost handling has its own implementation. | A genuinely write-consistent result requires consolidating the ordinary-create graph writes and projection into a per-item transaction. Keep plugin/external side effects after commit and outside retry callbacks. This changes partial-failure atomicity and needs approval; merely returning the first create projection would omit later edges/state. Review crossposts separately to avoid changing existing-discussion semantics. |
| `shareCollectionAsDiscussion` | Authenticated owner/public-collection checks and forum creation permission precede the same discussion helper; wrapper forwards `discussions[0]`. | Reuse the approved discussion snapshot policy and preserve collection ownership, visibility and channel permission checks. Do not fabricate a result when the helper returns no item. Decide whether an empty result is a clear error; today the non-null response fails during completion. |
| `pausePluginPipelineCampaign`, `resumePluginPipelineCampaign` | Authenticated plugin-manager gate; status lookup validates transition, then a separate update matches only ID. Disappearance returns undefined for a non-null root; a concurrent status change can also invalidate the earlier decision. | Atomically match ID plus expected state and update. Return `NOT_FOUND` for a missing campaign and `BAD_USER_INPUT` for a conflicting transition, with a deliberate transaction/locking strategy for distinguishing them. Preserve plugin-manager permission checks; do not silently overwrite a concurrent state based on stale validation. |

Source evidence: the two create helpers, collection-share resolver,
`pluginPipelineCampaigns.ts`, `campaignControlRepository.ts`, and their existing
real-driver disappearance witnesses. No race behavior changes are included here.
The proposal is per-item, not whole-batch atomicity, and does not claim that an
already-returned snapshot prevents a later deletion or permission change.

## Separate deterministic fixes to coordinate

1. `startPluginPipeline` and `rerunPluginPipeline` Discussion-target behavior was
   fixed in merged #442. Supported plural attachment selections and current/legacy
   content hashes are retained. Precise generated projections and execution tests
   now cover these successful paths; first-attachment policy is unchanged.
2. Profile/icon variant writes pass a nonempty object as a Neo4j property and fail.
   Existing storage scalar columns and JSON domain normalization offer implementation
   options, but storage compatibility and clearing/merge behavior need explicit tests.
3. The image-usage graph traversal question above remains separate work.
   The list-alias and dynamic-selection bugs were fixed in #443; opaque child types
   still require precise upstream contracts, rather than another behavior fix.

No extra PR is created by this checkpoint. Coordinate the behavior fixes separately
from #419; no merge/deployment/shared database writes or schema/permission changes.
