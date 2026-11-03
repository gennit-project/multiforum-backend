# Remaining response-contract decisions after #441

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

## Newly reproduced selection defects

`tests/integration/botSuspensionConnection.test.ts` uses the actual generated schema,
Shield and a canonical graph. `channels { Bots { username } }` returns the bot;
`channels { members: Bots { username } }` returns `members: []` without an error.
`emptyArrayFallback` looks up the schema field name on a parent projected under the
response alias. The aliased list silently loses data. Unaliased lists with nested
aliases/fragments and nullable malformed unrequested values still behave correctly.
Private moderator identity aliases are denied, and skipped identity fields remain
unrequested. Other registrations share the fallback, but the integration witness
specifically proves `Channel.Bots`; it does not claim every list was tested.

`tests/integration/issueActivityAndSoftDelete.test.ts` proves two separate
`addIssueActivityFeedItem` selection-forwarding failures:

- Aliasing the payload's `issues` field or putting it inside a payload fragment
  makes the refetch fall back to `{ id }`. A requested existing nullable title
  returns null. The moderation action still commits.
- A variable used in a selected field directive is copied into the refetch without
  its definition/value. The generated query errors after the action commits.

These are application adapter defects, not missing GraphQL validation. A separate
fix should collect all applicable field nodes by schema field name, merge applicable
fragments, preserve response aliases/directives and forward only referenced variable
definitions/values. Parent response keys must agree with the outer field resolvers.
It must preserve the existing outer Shield gates and denied-child behavior; an
internal unwrapped refetch is not permission evidence. Do not certify a generic
`executeGeneratedOperation<T>` cast or eagerly decode unrequested fields. Until
these selection defects are resolved, dynamic and pass-through contracts remain
explicitly deferred rather than counted via an opaque output type.

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

1. `startPluginPipeline` and `rerunPluginPipeline` Discussion-target branches still
   request unsupported singular `Discussion.DownloadableFile`. Existing executable
   schema witnesses fail before pipeline dispatch. Fix supported plural selection
   and define which attachment supplies input, preserving access checks and dispatch
   multiplicity; do not infer a first-file policy without inspecting current callers.
2. Profile/icon variant writes pass a nonempty object as a Neo4j property and fail.
   Existing storage scalar columns and JSON domain normalization offer implementation
   options, but storage compatibility and clearing/merge behavior need explicit tests.
3. The list-alias and dynamic-selection defects above need focused behavior fixes
   before their contracts can honestly be promoted.

No extra PR is created by this checkpoint. Coordinate the behavior fixes separately
from #419; no merge/deployment/shared database writes or schema/permission changes.
