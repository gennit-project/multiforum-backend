# V7_CODE_PATTERNS — code-layer migration template (campaign #284, Slice B)

Reference for fixing the ~486 `tsc` errors introduced by the `@neo4j/graphql`
5 → 7 bump. **The schema layer is done** (see commit `wip(graphql7): schema-layer
v7 migration`); this doc templates the **code layer**.

**Ground rules for every work unit**
- Do **not** edit `typeDefs.ts` or the generated files (`ogm_types.ts`,
  `src/generated/graphql.ts`) — they are frozen. Regenerate only via
  `pnpm run codegen` if you pull new schema changes; never hand-edit them.
- Fix your assigned directory's `tsc` errors to zero (production + co-located
  tests) by applying the patterns below **verbatim**.
- The generated `where`/`update`/input types are the source of truth. When unsure
  of a field's v7 shape, read its type in `src/generated/graphql.ts`.
- **Escalate, do not guess**, anything that looks like Family 3 (relationship
  connect/disconnect) — see the gate below.

Run `pnpm run tsc` to check. The error **code** tells you the family:

| TS code | Family | Count |
|---|---|---|
| TS2322 → `*ScalarFilters`, TS2345 → `*Where`, TS2559 → `*ScalarFilters` | 1 — filters | ~187 |
| TS2559 → `*ScalarMutations` | 2 — scalar mutations | ~133 |
| TS2353 `connect`/`connectOrCreate` not in `*FieldInput`; TS2322 → `*CreateInput`; some TS2339 | 3 — relationship inputs | ~95 |
| TS2305 `CollectionOptions`/`SubscriptionsEvent`; TS2322 `*Options` | 4 — options removal | ~6 (+ ~36 runtime strings) |
| TS7006 | 5 — implicit any | ~16 |

---

## Family 1 — scalar FILTERS (`where` clauses)

v7 requires explicit operator objects. A bare value is no longer a valid filter.

```ts
// v5
repository.findDiscussion({ id: discussionId });
const issueUpdateWhere: IssueWhere = { id: existingIssueId };
repository.findRelatedIssues({ channelUniqueName, relatedDiscussionId });

// v7
repository.findDiscussion({ id: { eq: discussionId } });
const issueUpdateWhere: IssueWhere = { id: { eq: existingIssueId } };
repository.findRelatedIssues({
  channelUniqueName: { eq: channelUniqueName },
  relatedDiscussionId: { eq: relatedDiscussionId },
});
```

Rules:
- Equality: `{ field: v }` → `{ field: { eq: v } }` for **every** scalar field
  (Id/String/Int/Float/Boolean/DateTime/enum).
- Suffix operators move inside the object: `field_CONTAINS: v` → `field: { contains: v }`,
  `field_IN: vs` → `field: { in: vs }`, `field_NOT: v` → `field: { eq: v }` under a
  `NOT`, etc. (check the generated `*ScalarFilters` type for the operator name).
- `AND`/`OR`/`NOT` wrappers are unchanged; only the leaf comparisons change.
- Relationship filters are unchanged in shape (`{ Rel: { node: {...} } }`) but their
  **leaf** scalar comparisons also need `{ eq: }` (e.g. `{ User: { username: { eq: x } } }`).

## Family 2 — scalar MUTATIONS (`update` clauses)

v7 wraps every scalar set in `{ set: v }` (type `*ScalarMutations`).

```ts
// v5
const issueUpdateInput: IssueUpdateInput = {
  isOpen: false,
  flaggedServerRuleViolation: didFlag,
  title: newTitle,
};

// v7
const issueUpdateInput: IssueUpdateInput = {
  isOpen: { set: false },
  flaggedServerRuleViolation: { set: didFlag },
  title: { set: newTitle },
};
```

Rules:
- Applies to Boolean/String/DateTime/Json/Int/enum fields in **update** inputs
  (`*UpdateInput`). Numeric fields may also offer `increment`/`decrement` —
  use `{ set: v }` unless the code intends arithmetic.
- Nested relationship keys inside an update input (`ActivityFeed: [{ create: [...] }]`)
  are Family 3, not Family 2 — leave the relationship key, wrap only scalars.

## Family 4 — `options` removal → `sort` / `limit` / `offset`

v7 removed the `options` wrapper and the `*Options` types.

```ts
// v5
import { CollectionOptions } from "../../src/generated/graphql.js";
const options: CollectionOptions = { sort: [{ createdAt: SortDirection.Desc }], limit: 10, offset: 0 };
repo.find(where, options);
// and in a GraphQL operation string:
`query($where: FooWhere, $options: FooOptions){ foos(where:$where, options:$options){ ... } }`

// v7 — drop the import; pass sort/limit/offset as siblings
repo.find(where, { sort: [{ createdAt: SortDirection.Desc }], limit: 10, offset: 0 });
// operation string: options splits into top-level args
`query($where: FooWhere, $sort: [FooSort!], $limit: Int, $offset: Int){ foos(where:$where, sort:$sort, limit:$limit, offset:$offset){ ... } }`
```

Rules:
- Remove `*Options` imports (TS2305) and type annotations.
- In GraphQL operation **strings** (the ~36 `options:` sites under
  `services/persistence/` etc.), replace the `$options: XOptions` variable and the
  `options: $options` arg with `$sort: [XSort!], $limit: Int, $offset: Int` and
  `sort: $sort, limit: $limit, offset: $offset`, and flatten the passed variables.
  **tsc will NOT catch these — they only fail at runtime.** Grep each repository for
  `options:` and fix every operation string; the integration suite is the check.
- `SubscriptionsEvent` import → the v7 name is `SubscriptionEvent` (singular) from
  `@neo4j/graphql` where needed.

## Family 5 — implicit any (TS7006)

Annotate the parameter. The common case is the subscription event collector:
`engine.events.on(kind, (event: unknown) => events.push(event))`.

---

## Family 3 — relationship inputs (connect / connectOrCreate) — **GATED, DO NOT FAN OUT YET**

This family is **not** mechanically templatable. v7 changed the nested-mutation model:

**Findings (verified against the generated v7 schema):**
- For **to-one (single) relationships**, v7 generates **no `connect` path at all**.
  Example: `ModerationAction.ModerationProfile` produces only
  `ModerationActionModerationProfileFieldInput = { create?: ... }` — there is no
  `*ConnectFieldInput`, no connect on the create or update input, only a read-only
  `*Connection`. The same holds for `Comment.Channel`, `Comment.Issue`,
  `Comment.CommentAuthor`, `Comment.ParentComment`, `TextVersion.Author`,
  suspension targets, etc. The top-level `*ConnectInput` lists only **to-many** rels.
- v7 connect semantics also changed generally: connect **always creates a new
  relationship** (no reuse), `overwrite` is removed, and `connectOrCreate` is removed
  (see the one `DiscussionTagsFieldInput` / `createEventSeriesWithChannelConnections`
  case). Updating an existing relationship now goes through `update`.
- **Good news — it's centralized.** The moderation-action connect is built once in
  `getModerationActionCreateInput` (`customResolvers/mutations/reportComment.ts:60`),
  used by ~20 resolvers (all `archive*`, `unarchive*`, `report*`, the suspension
  shared resolvers, and `services/botReportService.ts`). The 17 "not assignable to
  `ModerationActionCreateInput`" errors nearly all trace back to this one helper.
  Fixing the helper fixes the bulk.

**The open decision (the gate):** how to connect an existing to-one node in v7, given
no generated connect input. Candidate approaches, to be chosen in a focused spike:
1. **Direct driver write** for the relationship (create the node via the generated
   mutation, connect the moderator via a parameterized Cypher `MATCH … MERGE`),
   keeping leader routing / read-your-own-writes — fits this repo's persistence layer.
2. **Enable connect in `typeDefs`** via explicit `@relationship(nestedOperations: […])`
   on the to-one rels so v7 regenerates a connect input — but this unfreezes the schema
   and changes the public API, so it needs sign-off.
3. **create-then-`update`** — only if v7's update path exposes to-one connect (it does
   **not** for `ModerationProfile`, so this is likely a dead end here).

**Action:** run the Family-3 spike (read the v7 *Relationship operations* mutations
guide + prototype approach 1 against `getModerationActionCreateInput`) and record the
chosen pattern here before any work unit touches connect/relationship code.

---

## Fan-out map (Phase 1, after Family 3 is unblocked for the mechanical parts)

| Agent | Directory | ~errors | Families |
|---|---|---|---|
| A1 | `customResolvers/mutations/` archive*+unarchive* | ~90 | 1,2,3 |
| A2 | `customResolvers/mutations/` report*+image | ~90 | 1,2,3 |
| A3 | `customResolvers/mutations/` suspension+`shared/`+misc | ~66 | 1,2,3 |
| B | `customResolvers/fields`+`queries`, `hooks/`, `middleware/` | ~15 | 1,4 |
| C | `services/` (plugin triggers, bot*, persistence repos) | ~81 | 1,2,4 + runtime strings |
| D | `rules/` (validation + definitions) | ~77 | 1,2 |
| F | `tests/integration/` + co-located tests | ~137 | all — **last**, after prod signatures settle |

Each agent: owns one directory (no file overlap), fixes to zero `tsc` for its subset,
follows this doc verbatim, does not touch frozen files, and escalates Family-3
ambiguity. `customResolvers/mutations/shared/` belongs to A3 only.

---

## Phase 1 results (mechanical fan-out complete) — newly-gated items & runtime gaps

The 6-agent fan-out cleared all mechanical family-1/2/4/5 errors in the assigned
directories (486 → ~262 tsc errors). Remaining errors are: deferred
`tests/integration/` (agent F), family 3 (below), and two newly-surfaced gated
items. Record decisions here.

**Family 3 — expanded scope (confirmed across all agents).** It is NOT only
connect-on-create. v7 generates no nested connect/disconnect for to-one
relationships on EITHER create OR update inputs. Confirmed cases to resolve
together: the moderation-action builder (shared `getModerationActionCreateInput`
in `reportComment.ts` PLUS ~5 inline copies in reportImage/reportChannel/
reportChannelImage/reportProfilePicture/permanentlyRemoveImage), `IssueCreateInput`
Author/Channel, and to-one connect/disconnect on *UpdateInput: `LockedBy`
(lock/unlock), `PermanentlyRemovedByMod` (permanentlyRemoveImage), `Owner`
(ownershipSanitizers/Album), `Album` (DiscussionUpdateInput), `WikiHomePage`
(ChannelUpdateInput), `CommentAuthor`/`ParentComment` (CommentUpdateInput),
suspension targets. The chosen connect approach (driver write / typeDefs
nestedOperations / restructure) must cover connect AND disconnect, create AND update.

**GATED #2 — subscriptions.** v7's `features.subscriptions` accepts only
`boolean | Neo4jGraphQLSubscriptionsCDCEngine`. The app's custom in-process engine
(EventEmitter `events`/`publish`/`close`) is no longer a typed option
(`subscriptionsEngine` exists only on the internal `ContextFeatures`, not the
constructor). It still builds the schema at runtime, but trips tsc at
`index.ts` (features object) and `build_scripts/generateTypes.ts`. Decision needed:
adopt the CDC engine, keep the in-process engine behind a cast if it genuinely
works at runtime, or restructure. 2 known tsc errors left intentionally.
Related: v7 does not re-export `Neo4jGraphQLSubscriptionsEngine` or
`SubscriptionsEvent`/`SubscriptionEvent` from the package root — agent C replaced
those with local types in `subscriptionEngine.ts` and `channelCreatorModeratorRepository.ts`.

**Runtime gaps (tsc cannot see — for the Phase 2 integration pass):**
- `services/persistence/commentVoteRepository.ts` and `discussionChannelVoteRepository.ts`
  still select `UpvotedByUsersAggregate { count }` in their GraphQL operation strings;
  v7 removed `*Aggregate` in favour of `*Connection`. (The 4 upvote resolvers were
  switched to `UpvotedByUsers.length` by agent A3; the repos' op strings still need updating.)
- Resolvers that hand-build a `where` via `JSON.parse(JSON.stringify(...))` (e.g.
  `publicCollectionsContaining.ts`) have scalar leaves tsc can't type-check; they need
  the `{ eq: }` sweep for runtime correctness. Audit other such resolvers in Phase 2.

---

## Family 3 — spike decision & execution plan (APPROVED: driver write)

**Decision (evidence-backed):** v7 exposes no nested connect/disconnect for to-one
relationships anywhere — ruled out `nestedOperations` (adding
`[CREATE,CONNECT,DISCONNECT,UPDATE,DELETE]` still yields a `create`-only field
input), update-based connect (`ModerationActionUpdateInput` has only scalars; no
`ModerationActionConnectInput`), and denormalization (the
`PERFORMED_MODERATION_ACTION` edge is traversed by `getSiteWideIssuesQuery` /
`getModContributionsQuery`). → **Use parameterized driver writes**, following the
existing `OPTIONAL MATCH … FOREACH (… | MERGE …)` precedent in
`permanentlyDeleteStoredUpload`. Prototype primitive:
`services/persistence/moderationActorConnect.ts`.

**Two tiers (different risk):**

- **Tier A — moderation-action/issue creation (the crux, ~95 errors). NOT a safe
  parallel fan-out — build centrally, integration-test.** Built by the shared
  `getModerationActionCreateInput` + `getIssueCreateInput` (in `reportComment.ts`)
  and ~5 inline copies, executed through generated operation strings in
  `commentModerationRepository`, `discussionModerationRepository`,
  `eventModerationRepository`, `issueActivityRepository`, and `botReportRepository`
  (plus `attachIssueIdentityRelationships`). The structure is a `ModerationAction`
  embedding a `Comment` that connects union `CommentAuthor` (User|ModerationProfile,
  `AUTHORED_COMMENT` IN), `Channel` (`HAS_COMMENT` IN), `Issue` (`ACTIVITY_ON_ISSUE`
  OUT); the `Issue` itself connects an `Author` (union). Plan: one driver-backed
  `recordModerationAction` repository write (create-or-append issue + action +
  comment + all edges in Cypher), route the ~20 callers + the 5 repos through it,
  then validate with the moderation integration tests.
- **Tier B — standalone to-one sites (~30 errors). Fannable.** Each is a single
  targeted edge in its repository, via `MERGE` (connect) or relationship `DELETE`
  (disconnect), following the Tier-A primitive's pattern:
  - `LockedBy` connect (lockChannel, lockIssue) / disconnect (unlockChannel, unlockIssue)
  - `PermanentlyRemovedByMod` (permanentlyRemoveImage, report image paths)
  - `Owner` (utils/ownershipSanitizers: Album/Collection/Image)
  - `Album` on DiscussionUpdateInput (updateDiscussionWithChannelConnections)
  - `WikiHomePage` on ChannelUpdateInput (wikiRules + canEditWikiPagesRule test)
  - suspension targets (createSuspensionResolver: SuspendedUser/SuspendedMod/RelatedIssue)
  - rules/ family-3 (contentCreationRules, commentIsValid) are READ-side payload
    inspections of the now-removed `.connect` keys — adapt the inspection to the v7
    payload shape; these are not driver writes.

Each to-one edge: confirm the `@relationship(type, direction)` in typeDefs, then
MERGE/DELETE accordingly. Best-effort connects use OPTIONAL MATCH + FOREACH so a
missing target is skipped. Preserve leader routing (driver default).
