# Remaining response-contract decisions after #450

This is an investigation checkpoint, not approval to change behavior. The campaign
has 178 selected response/source boundaries and 31 deferred entries. The three
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
| `pausePluginPipelineCampaign`, `resumePluginPipelineCampaign` | Authenticated plugin-manager gate; status lookup validates transition, then a separate update matches only ID. Disappearance returns undefined for a non-null root; a concurrent status change can also invalidate the earlier decision. | Atomically match ID plus expected state and update. Existing open #446 returns `NOT_FOUND` for a missing campaign and `CONFLICT` for a changed record, retaining `BAD_USER_INPUT` for an initially invalid state. Reconcile that fix when merged rather than implementing another transition policy. Preserve plugin-manager permission checks; do not silently overwrite a concurrent state based on stale validation. |

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
Named moderator authors were already fixed by selecting both author branches.
The later internal-source metadata slice also covers null or omitted display names,
without changing recipient, permission or karma policy.
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


### Bot-report append numbering source — resolved

The real-schema regression in `botReportNumberSource.test.ts` first reproduced an
existing Issue whose stored issueNumber `"7"` was read as numeric `7` by GraphQL but
returned as string `"7"` by the bot API after append. The approved fix now returns
the already schema-validated number for an existing issue or the allocated number
for a new issue. Both owned adapters retain their actual raw source types instead
of whole-Issue casts, and compile-negative coverage prevents assuming the append
leaf is numeric. Re-running the regression against the old service fails with
`"7" !== 7`; the restored fix passes and leaves the stored string and one appended
action unchanged. Replays, authorization, other response fields and write/error
ordering remain unchanged. There is no additional read or post-commit validator.
This resolves the bot API result mismatch without claiming that persisted source
leaves or arbitrary JSON responses are fully certified.

### Public author union source continuation

The public comments/issues lists and root connections now carry private explicit
User/moderator branch discriminators, with real graph and Shield regression tests.
Their type no longer depends on requested username/displayName fields or aliases.
The subsequent internal-source metadata slice covers the fixed scratchpad read
and other explicit internal comments/issues roots. Other custom/nested sources
remain outside these registrations; this is not global union certification.
Inventory remains 176 selected / 33 deferred; neither pending policy is changed.

### Issue target-user selected child identity

The two direct `Issue.TargetUser` and `Issue.TargetProfilePictureUser` sources now
carry private identity dependencies on public `issues` and `issuesConnection`
reads when a protected User child is selected. Real GraphQL/Shield/database probes
first reproduced permitted owner Email reads failing when username was omitted.
`issueTargetUserSources.test.ts` covers both target relations, list/connection
aliases, fragments, directive defaults, owner/non-owner/anonymous access, null and
missing targets, pagination and local scalar failures. Public aliases cannot
replace the identity used by the child permission rule. This is an explicit
source-path guarantee, not arbitrary descendant or whole-User certification;
accounting stays 176 selected / 33 deferred. Internal fixed projections and both
pending product policies are unchanged by this slice.

### Internal moderator archive projection

The internal author discriminator also makes the existing moderator-authored
archive read executable. Its old failure witness has been replaced with a
passing graph regression. That regression additionally exposed a missing
`displayName` selection: the archive resolver already derives the related
moderator-profile target from that field, but the fixed read only selected the
profile's notification User. The read and precise projection now include nullable
`displayName`; type coverage prevents assuming it is non-null. Real graph tests
verify archive/rearchive/unarchive effects, the moderator-profile target rather
than a human-account target, existing notification recipients, and a nullable-name
read without writes. Public moderator User denial remains covered separately by
the author-source GraphQL/Shield tests. No new target fallback for unnamed profiles
is introduced, and accounting remains 176 selected / 33 deferred.

### Channel comment author sources

The explicit public channel-list and channel-connection paths now cover
`Comments.CommentAuthor` and selected parent/reply chains under those comments. Before the
adapter, real requests without author names returned a moderator as a User and
denied an owner's selected Email. The regression suite covers aliases, fragments,
variable directives, owner/other/anonymous permissions, human moderator anonymity,
filtered pages, missing/null values, age filtering, default limits and local
scalar errors. This is not arbitrary descendant or whole-comment typing;
`Channel.Comments` remains a deferred opaque item boundary and the inventory stays
176 selected / 33 deferred.

### Selected reply chains

The next regression reproduced moderator-as-User completion beyond the original
one-hop registrations. Comment-author path discovery now walks only the finite
selected `ParentComment`/`ChildComments` tree under registered comment roots and
channel Comments sources. It respects aliases, fragments and directive variables,
deduplicates canonical paths, and leaves the original document untouched. Internal
fixed reads use the same discovered paths with generated provenance, without
inserting public identity dependencies. Real graph tests cover deeper moderator
branches, protected owner children for owner/other/anonymous callers, root
connections and moderator anonymity through channel lists. Unit coverage proves
unrelated fields and skipped branches are not traversed. Other source families
and arbitrary mutation payloads remain outside this guarantee; no inventory entry
is promoted and no product policy is changed.

### Comment update payload authors

The generated `updateComments` response now uses the same selected reply-chain
identity adapter under its `comments` payload. Real GraphQL/Shield/Neo4j probes
first reproduced successful edits followed by missing-identity completion errors
for both User and moderator authors. Regression coverage preserves owner access,
non-owner/anonymous denial before writes, moderator anonymity, aliases, directive
defaults, missing targets and local child serialization errors after committed
writes. This does not move GraphQL completion inside the transaction.

The tests also reproduced a pinned Neo4j 7.6.4 update response-assembly defect:
its resolver finds the payload collection only among direct selections in the
first root field node, so a collection selected solely by a fragment was omitted
after the write. The comment-update adapter supplies a view with active payload
fragments expanded, preserving the original caller document and invoking the
write once. Unit coverage checks the unchanged original AST and skipped payloads.
This is bounded to this mutation's concrete response; other generated mutations
and multiple distinct collection aliases are not certified by this slice. The
inventory remains 176 selected / 33 deferred.

### Canonical image-usage source keys

Two real-graph probes reproduced alias collisions in application-owned usage
maps: User scalar aliases could read another canonical property, and an Images
alias matching the prepopulated Discussions key could return discussion entries.
The usage query now privately marks only the explicit canonical objects it builds.
For those objects, the relevant field middleware removes aliases from the
resolver's field-node view, while preserving the parent, arguments, selection
sets, context and error path. The shared list fallback likewise uses canonical
keys for marked sources. Unmarked generated response-key projections keep their
existing alias lookup. There is no eager scalar normalization or public marker.

Tests cover scalar and relationship collisions, mixed owned/generated sources,
owner/non-owner/anonymous private-field behavior, fragments and lazy local errors.
Precise raw leaves remain unknown and unselected relationships are not fabricated;
`getImageAlbumUsage` remains deferred. Other application-owned maps are not marked
without separate source evidence. Inventory stays 176 selected / 33 deferred.

### Delegated issue-activity source metadata

The activity payload's delegated Issue read reproduced the same owner-identity and
moderator-type loss as direct sources, despite an authorized, committed action.
The delegation now uses the shared-child query view with an explicitly scoped
metadata capture. Active target reads select private identity dependencies only
in the database resolver's view; GraphQL does not serialize those hidden fields.
Raw identity and author provenance are transferred privately to the corresponding
completed payload objects before outer Shield checks. Public data, caller context,
read policy, requested-field errors and the single action/comment write remain
unchanged. Fresh owned contexts isolate parallel payload aliases, and capture is
removed on success or error; nested GraphQL operations cannot replace its root.

Real tests cover owner children, moderator comments, payload aliases/fragments,
skipped fields, malformed stored identities, nullable moderator names, anonymity
and existing post-commit failures. The malformed-identity regression specifically
prevents treating scalar-coerced text as an authorization identity. Public Issue
roots now also cover the explicit activity User and Comment author sources. The
library's dynamic item result is still unknown, not a full Issue assertion; this
strengthens provenance without promoting the deferred activity boundary.

### Discussion-list canonical hydration maps

Three pre-fix real GraphQL probes reproduced sibling-key alias collisions in the
viewer vote lists and author scalars. The actual hydration query now has an exact
nested map declaration, retaining unknown persisted leaves and native driver
integer counts. Only these owned maps are marked as canonical; generated sources
continue to use their response keys. Aliases, fragments, skipped fields and local
scalar error paths keep GraphQL's normal completion behavior. No extra properties
are added to responses, and viewer filters, pagination and permissions are unchanged.

Executable projection checks read the actual Cypher document and compare every
root/nested map key with a compile-checked key set. Negative type fixtures prevent
mistaking raw author identities/titles or driver counts for validated output.
These guarantees strengthen the existing selected viewer boundary; unrelated lazy
children and arbitrary persisted values remain unproven. The three list field
registrations still expose opaque child contracts, so accounting remains
176 selected / 33 deferred.

## Finite remaining gates after discussion-list vote contracts

The two `DiscussionChannelListItem` vote fields now have actual generated selected
username signatures. Their only schema producer is guarded against drift, their
owned Cypher projection is checked against real database maps, and their usernames
come from the typed viewer parameter. This promotes precisely two entries:
**178 selected / 31 deferred**. It does not certify entire User objects.

The earlier 33 deferred entries divide as follows; this is the completion queue,
not a claim that coverage alone discharges a contract:

| Cohort | Entries | Remaining gate / disposition |
| --- | ---: | --- |
| Discussion-list viewer votes | 2 | Completed by the selected username registration, single-producer guard and exact hydration projection evidence above. |
| Shared generated and custom child lists | 18 | `Album.Images`, `Comment.SuperUpvotedByUsers`, `DiscussionChannel.SuperUpvotedByUsers`, and all 15 deferred Channel lists. Establish source provenance for every producer and selection-aware item contracts for generated versus owned maps, including aliases, selected null/scalar completion and authorization. Existing container/identity tests are supporting evidence, not completion. Engineering work remains; no new product policy is required. |
| Fixed custom child lists | 3 | `DiscussionChannelListItem.Flairs`, `ScratchpadEntry.superUpvotedByUsers`, `SiteWideDiscussionListItem.DownloadableFiles`. Exact owned projections and executable drift guards first; raw persisted leaves must stay lazy. In particular, scratchpad super-voters read arbitrary stored usernames in the write transaction, unlike the validated viewer-parameter lists; do not copy the new string assumption there. |
| Image-usage root | 1 | `Query.getImageAlbumUsage`: exact nested raw maps and canonical aliases exist. Still needs a generated selection-aware response boundary without eagerly validating unrequested persisted fields. No race or product-policy decision blocks its engineering work. |
| Activity payload | 1 | `Mutation.addIssueActivityFeedItem`: scoped metadata, query arguments and payload method are checked, but the delegation library returns unknown dynamic items. Complete a selection-aware delegated result boundary or document the exact pinned upstream execution trust boundary with enforceable selection/error tests. Do not cast that result to full Issues. |
| Intentionally unrestricted JSON | 6 | `JSON`, the three `variantUrls` fields, and two pipeline-update mutations. The public schema intentionally cannot promise object structure. Existing domain-specific contracts (variant string map/null and normalized pipeline inputs) remain enforced; changing these into structured GraphQL output would require a separate schema change. These are explicit structural limits, not ordinary unfinished list migrations. |
| Campaign transitions | 2 | `pausePluginPipelineCampaign` and `resumePluginPipelineCampaign`: #446 remains open and unmerged as verified in this checkpoint. Incorporate its tested transition result/error contract only when authorized/merged; do not duplicate its implementation or choose the unanswered in-flight worker pause policy. |

Completion requires closing the implementable source gates above, recording any
irreducible upstream/schema trust explicitly, and green full CI at the final head.
The separate omitted/null event-channel decision remains a residual behavior policy
outside these 31 entries; this queue does not choose it. Existing selected entries
also retain their documented unselected paths rather than implying whole-object
or end-to-end certification.

### Fixed flair item source contract

The discussion-list flair registration now uses a generated-schema-derived,
explicit six-field raw source selection instead of an unknown item array. It
preserves the generated field call signature and list/container shape. The actual
Cypher declaration additionally requires its explicit nullable color key, and the
existing real-query key test detects selection drift. Promise-wrapped generated
items are unwrapped in the source type; negative fixtures ensure they cannot turn
an invalid primitive into an empty permissive object type.

This is deliberately a source contract, not a string/Boolean/Int response claim.
Stored leaves remain unknown, nullable parent properties retain their schema
optionality, and GraphQL still validates only requested fields. Real tests preserve
archived assignments, nullable colors, malformed-name errors and missing-owner
errors at their selected aliases. The field stays deferred for generated scalar
response guarantees; the fixed source/container obligation is now checked. Twenty
other opaque lists still require their own upstream item-source work. No blanket
Partial, full-entity cast, eager scalar validation or count promotion is used.

### Scratchpad voter item source contract

The scratchpad voter field now has the same explicit generated raw-selection
boundary for `User.username`. Its actual Cypher read is a typed helper that uses
the existing write transaction, at the same point before commit. It still returns
stored values unchanged and preserves the nullable/empty fallback; it does not
claim arbitrary stored names are validated strings or substitute the current
actor for other voters.

Both comment and discussion query branches have real-database key-drift tests,
including nullable names, missing targets, visibility of an uncommitted vote and
rollback. Real GraphQL tests preserve the discussion response under aliases,
fragments and skipped fields, alongside existing permission, notification, karma
and repeat-operation cases. The field's source shape is checked; scalar response
completion remains GraphQL-owned, so the inventory stays 178 selected / 31 deferred.
Nineteen shared opaque list registrations remain, plus the two now-explicit raw
item sources. These categories are tracked separately from completed responses.

### Site-wide download item source contract

The third fixed child-list cohort now has an explicit generated raw selection for
file ID and scan status at its actual field registration. Its complete owned
hydration map replaces the previous untyped driver read, including authors,
albums/images, channel votes/flairs and native integer connection counts. Real
query tests compare all nested map keys with the declarations. A schema-producer
guard prevents silently reusing this custom list type for an unchecked producer.

Two pre-fix graph probes reproduced file-list and author alias collisions. Owned
maps now carry private canonical provenance; generated response-key sources remain
untouched. Tests preserve actual frontend connection counts, fragments/directives,
nullable authors/albums, pagination, visibility, malformed selected file enums,
and owner/non-owner/anonymous permission behavior. The fixed author projection
does not hydrate Email: authorized selection still completes null, while denied
callers retain their field error. No extra relationship read or full User claim
is introduced.

All three fixed custom list source/container obligations now have explicit raw
contracts, projection evidence and actual registration checks. Their persisted
scalar values remain GraphQL-owned, so they are not promoted to completed
response-value contracts. Accounting is still 178 selected / 31 deferred; within
the 31, three now have checked fixed item sources, six are intentional JSON
structural limits, two await campaign transition incorporation, and 20 retain
engineering gates (18 shared list sources, image usage and delegated activity).

### Image-usage full raw root selection

The actual image-usage registration now checks all four root properties and the
entire explicit nested album/owner/discussion/channel selection against generated
schema fields. A reusable asynchronous raw-source signature preserves generated
arguments, context and info. It rejects missing selected containers, malformed
item shapes and unrestricted JSON masquerading as a structured source. The real
owned query is exercised directly for exact key drift in both ownership groups;
GraphQL tests retain root aliases, string-coerced input IDs, sensitive filtering,
nullable relationships and field-level permissions/errors.

This does not promote the root solely for its parameter-bound image ID. Existing
raw persisted leaves remain unvalidated until requested GraphQL completion. Its
source/container boundary is now checked, while generated response-value status
remains deferred. Within the 31 deferred entries, four have explicit fixed raw
source boundaries, six are JSON structural limits, two await campaign transitions,
and 19 still have engineering gates (18 shared dynamic lists and delegated activity).

### Shared custom comment and answer producers

Four real GraphQL probes reproduced nameless moderators being inferred as Users in
custom discussion comments, replies, event comments and channel answers. The four
actual Cypher documents now compute a private discriminator from explicit,
unambiguous User/ModerationProfile labels. Source adapters retain it in the shared
WeakMap and make the database-only marker non-enumerable. Public names, aliases or
malformed unrequested scalar values no longer choose the author type; ambiguous
labels retain a lazy abstract-type error rather than guessing an identity.

Exact root/reply/event comment and channel-metadata declarations replace the
previous catch-all comment projections. They distinguish raw stored voter names
from matched viewer names and native count values. Canonical provenance covers
these owned maps, including bot/moderator summaries, versions and counts; generated
response-key sources are untouched. The actual query documents have nested key
and discriminator drift checks, with permission, alias/fragment/directive, missing
relation, malformed scalar, privacy and five-answer-cap regressions. Existing
ranking, pagination, count, age-filter and event swallowing/error behavior stays
covered. The human account behind a moderator remains denied.

This closes specific owned-producer gaps for shared Comment/DiscussionChannel and
Channel child lists. It does not certify every generated or custom producer of
those shared types or their unprojected relationships. The 18 dynamic list gates
therefore remain open; response accounting stays 178 selected / 31 deferred.

### Activity delegation: explicit upstream runtime boundary

The remaining activity-result gate is now characterized by executable tests of
its actual query-only adapter against real GraphQL schemas. With the pinned
`@graphql-tools/delegate` 12.3.0, the target executor completes requested scalar
values, rejects malformed list containers, bubbles selected non-null failures,
resolves abstract types and preserves located errors/extensions. Nullable roots
and items remain nullable. Fragments, variables, aliases and skipped fields do
not trigger eager validation of unrequested values. The helper now forwards only
its declared options; a regression fails against the earlier spread because an
undeclared transform could reach the delegate library.

The result still cannot honestly be called a complete `Issue[]`: its keys and
shape depend on the caller's selection, and inner errors may be represented for
later outer completion. Aliases also require response-key-aware consuming
resolvers; the isolated adapter fixture uses the library's merged resolver, while
production tests exercise the actual Neo4j resolvers and outer Shield. Existing
real-database activity regressions retain one committed write, skipped-read
behavior, post-commit read failures, raw private identity and moderator anonymity.
No decoder, authorization shortcut, extra read or full-object assertion is added.

This closes the **upstream execution characterization** gate, not the static
response guarantee: activity is an explicit dynamic upstream trust boundary and
stays deferred in the two-status inventory. Accounting remains **178 selected /
31 deferred**: four checked fixed raw sources with scalar-response limits, six
intentional JSON structural limits, one now-characterized delegated runtime
boundary, two campaign-transition dependencies, and **18 shared child-list
engineering gates**. The shared lists still need producer-specific source work;
these tests do not discharge those obligations or certify whole operations.

### Sorted channel source: tags and count projections

The sorted-channel producer no longer uses a catch-all persisted map. Its exact
scalar, tag and native-integer count maps are checked against a generated raw
root selection and the actual executable query's keys. Negative type fixtures
reject absent tag selections, serialized count substitutions, unvalidated string
claims and unprojected admin lists. A missing required child selection also fails
the actual root registration contract.

Three pre-fix real-schema regressions reproduced wrong scalar values, an empty
tag list and a connection error under aliases. Only this owned query result is
now marked as canonical, including its nested tag/count maps. Generated alias
projections pass through unchanged. Real tests preserve lazy malformed-scalar
errors, nullable fields, filtering, search, ordering, pagination and favorites;
no missing child relationships are fabricated. `Channel.Tags` stays deferred:
this closes one fixed producer's source gap, not every shared dynamic producer.
Accounting remains 178 selected / 31 deferred and 18 shared-list engineering gates.

### Discussion detail and continuation-page sources

The initial detail read's core, channel and files, plus all three continuation
queries, now have exact raw item projections. The actual registrations check
public source keys against generated raw selections while preserving existing
selected scalar guarantees. The page factory retains its answer/file/image
result type through each branch. Database cursor IDs remain raw through encoding;
the existing decoder still rejects malformed IDs. This removes the old string
assertion without changing malformed-data behavior or claiming every encoded
cursor is usable.

Initial and paginated answers reproduced the nullable-moderator-name inference
bug. Both queries now produce private explicit label provenance; ambiguous labels
remain selection-time errors, missing authors stay null and the human account
behind a moderator stays protected. Canonical owned maps also preserve aliases
through core fields, assets, uploader/author identities, channel counts, labels,
crossposts and shared collections. Generated projections are not marked.

Compile-negative fixtures and real-query key guards cover all six query documents.
Real GraphQL/Shield tests cover aliased fragments/directives, lazy scalar failures,
nullable/ambiguous authors, age filtering, protected User children and raw identity
comparisons. Existing pagination tests retain first-page limits and continuation
ordering. No schema, permission, privacy, read transaction or limit change is
intended. `Album.Images` and `DiscussionChannel.SuperUpvotedByUsers` gain precise
owned producers, not universal shared-field guarantees. Inventory remains 178
selected / 31 deferred; the 18 shared-list gates still need final producer
reconciliation. Event-comment metadata remains a separate fixed source to inspect.

### Event-comment metadata source

The viewer-read family's final catch-all persisted map is replaced by the exact
metadata query result: event fields, tags, nullable poster/channel maps and
predicate-matched viewer subscriptions. Its actual registration now checks the
public raw selection against generated schema keys. Native Point conversion stays
with Neo4j's existing field resolver and is explicitly outside the structural
selection; a real point alias test covers that behavior.

Three failing baseline probes reproduced swapped scalar values, crossed
subscription aliases and nested poster/channel alias errors. Canonical source
provenance fixes only the owned maps. Tests preserve anonymous/unrelated viewer
state, protected poster children without public username selection, raw identity
comparisons, nullable posters/channels, fragments/directives and selection-time
scalar errors. An initial test incorrectly expected a missing channel to error;
the schema permits null, so the final regression preserves null. No event-input
omitted/null policy is changed. Counts remain 178 selected / 31 deferred.

The next finite gate is a producer-by-producer reconciliation of the 18 shared
child lists: fixed query maps now have explicit sources, while generated dynamic
projections need their own documented selection-aware upstream guarantees. Do not
promote them merely because this viewer family no longer has catch-all types.

### Fixed collection projection reuse

The shared Album.Images audit identified another owned producer: the public
collection snapshot. Its existing generated selection and executed-document guard
already describe the fixed image/author maps, but inner GraphQL completion creates
new objects that are later reused by outer field resolvers. Profile and public
collection maps now retain canonical source-key provenance, including selected
nested images, counts and author maps.

Only the explicitly opted-in fixed public collection read transfers private User
identity from its two declared source paths through completion. It uses the same
owned context, document, JWT and database read; no hidden selection, request
identity inheritance or eager decoder is introduced. The generic scope helper can
preserve a typed execution envelope without asserting its nested result type.
Other internal operations keep their existing execution path. The generic
`executeGeneratedOperation<T>` trust boundary is not promoted to whole-result proof.

Real GraphQL regressions cover both alias failures and source-identity preservation,
including owner/outsider/anonymous access, parallel aliases, skipped private fields
and nullable creators. The malformed-identity baseline uses a native floating
number that String completion accepts; a native Neo4j integer instead fails in the
fixed internal document, which is a different existing error boundary. Fixed
internal reads still validate their own selections even when the outer caller
omits those fields. This closes another owned-producer gap without changing that
behavior, inflating the inventory or declaring all dynamic Album.Images sources
complete. Existing profile visibility/filter regressions remain required.

### Generated shared-list source matrix

The 18 remaining shared lists now have executable generated-source probes through
Neo4j, GraphQL and Shield: independent aliases and filters, ordering/pagination,
empty lists, fragments/directives, and selected versus unrequested malformed
persisted fields. This characterizes generated execution rather than asserting
that arbitrary dynamic results have complete static object types.

The voter-source checks also require selection-aware private identity on regular
and super-voter lists from comment and discussion-channel query roots, including
connections. Comment reply paths reuse the finite selected-document traversal;
internal author-only discovery remains unchanged. Owner, unrelated and anonymous
access, omitted usernames and raw identity comparisons remain explicit test gates.
No public schema, vote persistence, voter ordering or permission rule changes are
intended. Other nested producers still require reconciliation; passing root-source
probes do not close every shared-field contract. Inventory remains 178 selected /
31 deferred, including the 18 shared-list gates.

### Generated album image actors

Generated album list and connection reads now carry private raw identity for the
explicit `Images.Uploader` and `Images.PermanentlyRemovedByUser` paths, alongside
the existing album owner. Real GraphQL/Shield probes cover independent source
aliases, fragments/directives, owner/unrelated/anonymous callers, missing actors,
omitted usernames, raw coercible identities and sensitive-image filtering.
The fixed public collection projection has separate source evidence and remains
covered. This does not certify every other producer of Album or Image; the shared
`Album.Images` contract remains deferred pending that reconciliation.

### Channel moderator bot-account source

The explicit channel list/connection producer now preserves private raw User
identity for `Moderators.BotUser`. The generated Cypher still selects only bot
accounts; the denied human-account edge remains denied, including aliases and
fragments. Real GraphQL/Shield tests cover owner/unrelated/anonymous callers,
omitted identity fields, skipped private fields, empty selections and both root
shapes. This is one checked nested producer of `Channel.Moderators`, not a claim
that every profile descendant or dynamic source is statically certified. The
shared-list inventory remains deferred.

### Generated source-path declaration checks

Explicit User paths for channel/album/voter, server, image, profile, wiki/version,
label-change, discussion/event/series and collection sources now use a reusable
compile-time gate against their declared generated schema root types. It accepts
nullable/list edges and rejects misspelled fields, non-User endpoints, unknown or
JSON sources and impossible/mixed discriminators. The path arrays retain their
literal types and are passed unchanged to the existing selection-aware adapter.

Compile-negative fixtures fail if the gate is removed (verified by temporarily
removing it and restoring it before final checks). This proves declaration drift
coverage, not persistence values, authorization, completeness of the registration
catalog or arbitrary generated result shapes. Author-union paths keep their
separate discriminator machinery. Existing real query source tests remain the
behavioral evidence; no inventory entry is promoted by this declaration check.

### Shared-list probe manifest and registration drift

All 18 generated-root probes now come from one manifest checked against generated
schema list keys, matching parent/root identities and the actual
`emptyArrayFallback` registrations. CI rejects missing, stale or duplicate probes;
removing one manifest entry was verified to fail the real registration guard.
Compile-negative fixtures reject scalar/JSON fields and mismatched roots. The same
manifest drives the real GraphQL suite, so the guard protects executed coverage
rather than a disconnected checklist. Per-field audit evidence records these
checks while retaining each unresolved item/provenance obligation and the unchanged
178 selected / 31 deferred accounting.

### Cursor performance regression investigated on Neo4j 5.26.33

The unchanged pipeline cursor query failed the existing 70-intermediate-row budget
on CI heads ffa8abe and 5dac456. Local Neo4j 5.26.32 initially stayed at 11 rows.
After refreshing the disposable 5-community image to 5.26.33, the original query
reproduced CI's 100 rows / 324 db hits: the tied-date branch used the composite
index's broad non-null prefix and filtered the date afterward. Resampling retained
that plan; forced replanning could instead choose the bounded seek, explaining why
passing runs alone did not establish a fix.

Cursor branches now omit only redundant date-presence predicates (and redundant
id presence in the equality-plus-id-range branch). Their comparisons already
exclude those null values. The older-date branch retains explicit non-null ids;
first-page queries, filters, ordering, limits and budgets are unchanged. The
candidate stayed at 11 rows / 224 db hits under both observed local versions and
all exercised replanning modes. The real pagination regression also covers missing
date/id properties, timestamp ties and event filtering before page limits. Full CI
must pass on the final head; earlier failing heads remain failures. Failing plans
are retained in the existing always-uploaded performance artifact for future
investigation.

### Metadata adapters preserve upstream types

The identity/author metadata adapters now preserve a caller's declared parent,
arguments, context, result shape and nullability, for synchronous and asynchronous
resolvers. Known fixed-source projections no longer become `unknown` merely by
passing through metadata capture. Unknown source values remain unknown; the
adapter still does not decode scalars or invent fields. The fixed collection
capture wrapper follows the same contract.

Compile fixtures reject widened usernames, invented fields, lost nullability and
invalid arguments. Restoring the earlier erased signatures made the positive
fixtures fail; restoring the generic signatures passes. TypeScript transpilation
of both changed runtime files produces identical executable JavaScript. This is a
source-type preservation improvement, not a new claim about unchecked producers
or a promotion of any shared-list inventory entry.

### Machine-checked completion cohorts

Every deferred audit entry now has an explicit disposition, checked by CI against
its actual JSON output type or named source/registration gate. The unchanged 31
entries comprise **18 source migrations still requiring work**, **four fixed raw
sources whose scalar responses remain GraphQL-owned**, **six public JSON schema
limits**, **one pinned delegation runtime boundary**, and **two pending transition
policy/dependency entries**. Source migrations cannot be relabeled as schema limits
without failing the guard. #446 remains open and unmerged at the verified head
207f9118989ad42cad4d01adacf4ebb657cb9268; no transition or worker-pause behavior was
changed. This finite accounting records unfinished work rather than declaring the
campaign complete because a CI run passes.

### Fixed forum membership write items

The eight owner, moderator and invitation write methods now preserve the exact
32-field completed Channel projection instead of returning `unknown[]`. Every
selected nullable key remains present; DateTime values are completed strings,
and public JSON scalar contents remain unknown. Compile-negative fixtures reject
missing selections, malformed completed values and invented relationship fields.

A real disposable-database suite intercepts the actual generated mutation
resolver and compares every executed selection to the declared source contract,
then checks completed items and missing-target lists. Existing repository tests
retain repeated-write, permission wiring, generated limits, coercion, notification
and committed-write projection-failure evidence. No selection, write ordering or
error policy changes. These fixed scalar-only items do not close any of the 18
dynamic shared-list source obligations; accounting remains 178 / 31.
The guard was exercised by temporarily removing `displayName` from the real
mutation selection: the executed-selection regression failed, and the document
was restored. Nine new integration cases and all 32 existing membership repository
cases pass; the public response types and fixed documents remain unchanged.

### Related-channel selected item sources

Related Channel items now retain the same declared child-source metadata as the
root Channel, recursively through requested RelatedChannels edges. The edge and
terminal User paths are checked against generated schema types; recursion follows
the finite validated selection and skips inactive branches. Canonical connection
wrappers remain distinct from response-key child projections. Existing comment
and moderator source handling is retained at each selected Channel.

Real GraphQL/Shield regressions cover root and connection paths, nested aliases,
fragments/directive variables, empty selections, omitted public identities and
raw identity comparisons. The owner-access regression fails before this fix.
This closes a concrete selected-source gap, not the whole RelatedChannels item
contract. The 178 / 31 inventory and 18 unfinished shared-list gates are unchanged.

### Fixed server membership write items

The six server administrator/moderator acceptance, cancellation and invitation
writes now retain their exact 25-field completed ServerConfig items instead of
`unknown[]`. Selected nullable properties remain present. String arrays keep
non-null elements; the three JSON fields retain unknown contents. Compile fixtures
reject incomplete items, wrong completed scalar values and unselected moderators.
Actual generated write selections and missing-target lists are checked through
GraphQL and disposable Neo4j, alongside the existing relationship/event/failure
regressions. No query, return/error behavior or inventory status changes.
All 35 focused integration cases pass. Temporarily removing serverDescription from
the actual executed document makes the selection guard fail; restoring it passes.

### Required keys at owned fixed root boundaries

Fixed root raw selections now require every declared selected key recursively,
including nullable properties and list items. Earlier fixtures showed that
omitting a nullable root or child property still compiled; those cases now fail.
All actual registered fixed root sources satisfy the stricter boundary. Explicit
null/undefined raw leaf values remain allowed and GraphQL still owns scalar
completion. Generated field-parent arguments keep their existing optionality, so
the change does not pretend arbitrary upstream parents emitted a fixed projection.
This strengthens existing owned-source obligations without runtime changes or
claiming a full response-value guarantee; inventory counts remain unchanged.

### Undo-super-vote remaining-user items

Both actual transaction reads now retain exact `{username: unknown}` items instead
of an opaque result. The registered resolver checks that fixed child selection in
addition to its existing completed success/message/source fields. Compile fixtures
reject primitive or missing-key items and claims about unselected User fields.
Real GraphQL/Shield alias probes pass before and after the type change; no runtime
bug or new response behavior is claimed. Removing username from the real comment
and discussion read queries makes both probes fail. All 34 focused integration
cases pass, including uncapped results, lazy malformed usernames, committed
successful undo state, permission failures and rollback on write failures.
The mutation's completed scalar coverage and overall inventory counts are unchanged.

### Ordinary and featured wiki item producers

Both `getSiteWideWikiList` queries now retain exact eight-key wiki maps and
three-key nullable VersionAuthor maps. Their actual root registration checks the
fixed raw selections alongside the existing Integer/count completion boundary.
Compile fixtures reject omitted keys, incomplete authors, invented relationships
and completed-string claims about raw dates. Removing the nullable body selection
from the actual query documents makes the executed-key guard fail.

Four baseline probes reproduced collisions between response aliases and stored
wiki/author keys. Only these owned maps are now marked canonical, with private
raw author identity; generated wiki sources remain unmarked. The 36 focused wiki
source and attribution cases pass, covering aliases/fragments, native date
completion, nullable authors, skipped malformed values, owner/outsider/anonymous
checks, featured duplicates/order and ordinary filtering/pagination. Existing
count/search behavior is retained. This closes this fixed producer's structural
gap; persisted values remain lazy and no shared-list inventory entry is promoted.

### User and channel contribution item producers

`getUserContributions.activities` and
`getChannelContributions.dayData.activities` now retain the exact nested maps
emitted by their owned Cypher documents. Root registrations check those raw
selections alongside existing computed date/count guarantees. Persisted scalar
values remain unknown; nullable selected keys are required and no unselected
User properties are invented. The channel query still gathers discussions and
comments only (including its existing treatment of download discussions); its
other three schema-required activity lists are explicitly empty.

Five tests against the published baseline reproduced canonical/response-alias
collisions and missing non-null channel activity lists. Private canonical-map
metadata now preserves aliases throughout these owned maps and raw author
identity for field authorization. Generated maps are not marked. Thirteen new
real GraphQL/Shield/Neo4j cases cover all five user activity kinds, aliases,
fragments, directive variables, nullable relations, skipped malformed leaves,
owner/outsider/anonymous requests and a coercible raw identity that must not
become an owner identity. Actual-query key guards reject removal of the selected
nullable profilePicURL field from either query. Existing date/count, age-gating,
limit, target lookup and failure behavior tests remain applicable. Inventory
stays 178 checked / 31 deferred: these are producer obligations, not certification
of arbitrary shared entities.

This batch was reconstructed in a separate checkout from d7190d7 after executor
replacement. No claim is made that the unavailable workspace's unpublished edits
or its two stashes were recovered.

### Finite producer follow-up after the contribution batch

The root-producer census is a discovery aid, not a completeness proof. Its next
concrete obligations are:

- `getModContributions.activities`: exact action/feedback nested maps, actual-query
  drift checks, negative type fixtures, real selection/permission tests, and no
  human-account attribution through moderator activity.
- `getUploadedDownloadableFiles.files`, `permanentlyDeleteDownloadableFile`,
  `createImageWithUploader`, `permanentlyDeleteImage`: distinguish native-property
  leaves from owned relationship maps; certify the latter against executed queries
  without pretending native properties are completed scalar values.
- The shared Issue producers: `suspendUser`, `unsuspendUser`, `suspendMod`,
  `unsuspendMod`, `lockIssue`, `unlockIssue`, `archiveImage`, `unarchiveImage`,
  `archiveComment`, `archiveDiscussion`, `archiveEvent`, `unarchiveComment`,
  `unarchiveDiscussion`, `unarchiveEvent`, `reportComment`, `reportDiscussion`,
  `reportEvent`, `reportWikiEdit`, `reportChannel`, `reportImage`,
  `reportProfilePicture`, `reportChannelImage`, `permanentlyRemoveImage`. Audit
  their shared moderation-write/issue-lock implementations, fixed relationship
  overrides and selected completion paths; retain explicit native-property limits.
- Extend the census beyond root registrations to custom field producers (including
  collection/profile sources). Any additional fixed-map obligation must receive
  the same executed-query and selection/authorization evidence before closure.

Already closed fixed producers include the eight forum-membership writes, six
server-membership writes, both remaining-super-voter transaction reads, and both
ordinary/featured wiki-list paths. Unrestricted scalar/JSON, upstream activity
execution, dynamic selection and the pending product policies remain separate
from this implementable work. None closes the 18 shared-list gates automatically.
