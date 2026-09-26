# Store the age-gate result on each node: design

Status: **approved direction, implementation in progress** (decisions recorded 2026-09-26).

## Problem

Eight types carry the age-gate filter:

```graphql
@authorization(filter: [{ operations: [READ, AGGREGATE], requireAuthentication: false,
  where: { OR: [{ node: { ageGateSensitive: false } }, { jwt: { mayAccessSensitiveContent: true } }] } }])
```

`ageGateSensitive` is a `@cypher` field, so `@neo4j/graphql` inlines its statement into every generated query that touches one of these types, including nested selections. Measured on production (`getIssue`, 2026-09-26):

- Once planned, the query executes in **2–3 ms**. Planning a fresh copy takes **420–660 ms**, and several of these plan concurrently on each page load.
- With the age-gate statements replaced by `false`, the same query plans in **~185 ms** (about 60% less) and is about a third shorter (14.8 KB → 9.6 KB).
- The statement runs for every candidate node **before** the request's own `WHERE` (70× the database hits for `getIssue`).
- It's worst when content *isn't* sensitive, which is the common case. Proving a comment isn't sensitive means walking its whole reply chain (`IS_REPLY_TO*0..`) to the top-level discussion.

| Type | Current check |
|---|---|
| Discussion, Image | own `hasSensitiveContent` (cheap) |
| DiscussionChannel, DownloadableFile, FileVersion | fixed one- or two-hop traversal |
| Comment, TextVersion, Issue | variable-length reply-chain traversal, 3–5 `EXISTS` |

## Decisions

The model is Reddit's NSFW tag:

1. **Content is clear unless marked.** Only content marked sensitive (`hasSensitiveContent` on a Discussion or Image) is age-gated. Unmarked content is visible to everyone, and that's the normal case.
2. **Marking passes down.** Everything under a marked discussion or image is gated too: its channel entries, comments and replies, feedback comments, text versions, downloadable files and file versions, and issues about it. (Reddit treats comments as part of their post the same way.)
3. **Signed-out visitors are restricted** when the gate is on. (Already true today: `mayAccessSensitiveContent` denies unauthenticated callers when the gate is enabled.)
4. **No birthday at sign-up.** The birthday is asked just in time, the first time someone opens a sensitive page directly (see [Just-in-time age check](#5-just-in-time-age-check)). The separate account age gate (`accountAgeGateEnabled`, which asks for a birthday during sign-up) stays off.
5. **Performance first.** The stored flags and the filter switch ship before the write-safety work, under an interlock (see [Order of work](#order-of-work)).

## Design

### 1. Store "restricted"; unmarked means clear

Each of the six derived types (DiscussionChannel, DownloadableFile, FileVersion, Comment, TextVersion, Issue) gets a stored boolean:

```graphql
ageGateRestricted: Boolean   # true = under marked content; null/false = clear
  @settable(onCreate: false, onUpdate: false)
  @selectable(onRead: false, onAggregate: false)
```

It is never settable through the API. The filter becomes a plain property check that treats a missing value as clear:

```graphql
where: { OR: [
  { node: { ageGateRestricted: false } },
  { node: { ageGateRestricted: null } },
  { jwt: { mayAccessSensitiveContent: true } }
] }
```

Discussion and Image filter the same way on their own `hasSensitiveContent`:

```graphql
where: { OR: [
  { node: { hasSensitiveContent: false } },
  { node: { hasSensitiveContent: null } },
  { jwt: { mayAccessSensitiveContent: true } }
] }
```

`…_NOT: true` is **not** equivalent. In Cypher, `NOT (null = true)` evaluates to null and `WHERE` rejects it, so it would hide every node that never had the property set, which is nearly all content. The rollout includes a null-property test for every filter.

The `ageGateSensitive` `@cypher` fields stay in the schema as the **reference definition** that the sweep and the tests compare against. They're just no longer used by `@authorization`.

### 2. The tradeoff of "clear unless marked"

With this default, a stale or missing flag **fails open**. If a reply is created under a marked discussion without being marked restricted, restricted viewers can see it. So marking at write time and re-evaluation on change are the confidentiality guarantee, not an optimization. The sweep is an audit and a backfill, not a safety net.

While the gate is **off** (topical.space today), everyone may see sensitive content, so flags have no visible effect. Nothing is marked sensitive on topical.space today (checked 2026-09-26), so there's nothing to leak yet.

### 3. Keeping flags correct

A derived node's result can change in three ways. All three are leak-relevant.

1. **A new node is created under marked content**, for example a reply on a sensitive discussion. The creating path must set `ageGateRestricted = true` in the same transaction. Paths:
   - comment creation (root comments, replies, feedback comments)
   - the version-history services that create `TextVersion`s
   - discussion and channel creation (`DiscussionChannel`)
   - issue creation (related discussion, comment or image)
   - downloadable file and file-version upload
2. **A Discussion's or Image's `hasSensitiveContent` changes.** Every derived node beneath it is re-evaluated in the same transaction: marked on `true`, re-evaluated on `false`. A descendant can still be restricted through another route, such as a feedback comment on a different sensitive discussion.
3. **An existing derived node is attached to a different root**, or an identifier its definition uses changes. From the generated inputs:
   - reconnecting `DiscussionChannel.Discussion`, or connecting an existing channel entry through `Discussion.DiscussionChannels`
   - reparenting a Comment through `DiscussionChannel`, `ParentComment`, `GivesFeedbackOnDiscussion` or `GivesFeedbackOnComment`, or connecting an existing comment through `DiscussionChannel.Comments`, `Comment.ChildComments`, `Discussion.FeedbackComments` or `Comment.FeedbackComments`
   - reconnecting `DownloadableFile.Discussion` or `FileVersion.mainFile`, or connecting existing files and versions from the parent side
   - connecting an existing TextVersion through a Discussion's title/body history or a Comment's version history
   - changing an Issue's `relatedDiscussionId`, `relatedCommentId` or `relatedImageId`

   **Creating** a new node that connects to its parent is covered by (1). The risk is an **existing** node moving under marked content.

The safe write surface is kept small and explicit:

- **Allowed root-sensitivity paths:** `createDiscussionWithChannelConnections`, `updateDiscussionWithChannelConnections`, `updateDiscussions`, `createImageWithUploader`, `updateImages`. `updateDiscussionWithChannelConnections` also covers album edits, which set `Image.hasSensitiveContent` through nested image inputs, and file attachments. Its transaction covers the images changed inside it, files attached to it, and any issue that references them.
- **Everything else is rejected.** A schema-aware validator walks the complete mutation input and rejects unhandled writes of `hasSensitiveContent` and of the dependency routes above, including nested writes through `@neo4j/graphql` relationship inputs. As of 2026-09-26, **28 allowed mutations** can reach such a write through nested inputs, which is why per-mutation hooks aren't enough. A CI test fails if an age-gate definition starts using a relationship the validator doesn't cover. The validator ships **log-only** first, to inventory real traffic, then enforces.
- **Audit:** the sweep reports any node whose stored flag disagrees with the reference definition. A mismatch means a write path was missed.

Over-marking is safe (content is hidden from restricted viewers until re-evaluated). Under-marking is the leak.

#### Transaction ownership

An ordinary GraphQL middleware that calls `resolve()` and then runs Cypher is **not** inside the mutation's transaction: the generated resolver has committed before it returns. The implementation therefore uses explicit transaction ownership, not a post-resolver hook:

- For handled generated mutations, transaction-coordinating middleware begins a Neo4j transaction before `resolve()`, installs it as `context.executionContext`, runs the generated resolver and the shared re-evaluation helper on that transaction, then commits. Any error rolls the transaction back.
- Handled custom resolvers own the same transaction explicitly. Every participating OGM call receives it through `context.executionContext`, and raw Cypher uses it rather than opening another session. The current discussion create/update resolvers use independent OGM and session transactions, so they must be refactored. Post-commit work such as plugin triggering stays outside the transaction.
- If a path cannot share the transaction, it cannot write a sensitivity root or dependency field. A standalone follow-up query is not sufficient.

### 4. Sweep (manual)

Nothing runs on a timer. A command compares every derived node's stored flag with the reference definition:

```bash
pnpm run age-gate:sweep              # dry run: report mismatches, change nothing
pnpm run age-gate:sweep -- --apply   # mark/unmark as needed, in batches
```

On production the script runs the compiled build (`ts-node` isn't installed there). Pass the command as **one quoted string**, because Heroku CLI 11 mangles unquoted multi-word commands:

```bash
heroku run -a topical-backend-dev -- 'pnpm run age-gate:sweep'
heroku run -a topical-backend-dev -- 'pnpm run age-gate:sweep -- --apply'
```

Locally, `pnpm run age-gate:sweep:dev` runs the TypeScript source through ts-node.

Run it:
- **once as the backfill**, before the filter switch
- **before turning the age gate on** for an instance
- **whenever a dry run reports mismatches**, which means a write path needs fixing

### 5. Just-in-time age check

Restricted viewers don't see gated content in lists, feeds or search. When someone opens a gated page directly, from a link or a notification, the page shows a gate instead of "not found":

- **Signed out:** "This content is marked sensitive. Sign in to continue."
- **Signed in, no birthday:** "You must be *N* or older to view this. Enter your birthday." It's stored once through `setMyBirthday`, which can't be changed afterwards, and the user is never asked again.
- **Under the minimum age:** "You can't view this content."
- **Allowed:** the content.

The page needs to know that gated content exists without receiving any of it, since even the title may be the sensitive part. A small query answers "does this exist, and does it need an age check?" for a discussion, comment or download id, and returns no content fields. The frontend adds the gate UI (sign-in prompt, birthday form, refusal).

A self-entered birthday is a self-declaration, similar to Reddit's opt-in, and suits "mature/NSFW" content. Some jurisdictions require stronger age verification for explicit adult content (for example the UK Online Safety Act and several US state laws). Revisit before hosting that kind of content.

### 6. What stays the same

- The access decision (`mayAccessSensitiveContent`) and the `jwt` claim.
- Custom Cypher resolvers that filter sensitive content directly (`customResolvers/cypher/*`). They keep their own checks; converting them is optional follow-up work.
- Subscription authorization (`@subscriptionsAuthorization`) is jwt-only already.

## Order of work

Performance first, made safe by an interlock:

1. **Stored flag and sweep.** Add `ageGateRestricted` and the sweep command, then run the backfill. No read behavior changes.
2. **Filter switch, with an interlock.** Switch the eight `@authorization` filters to the stored properties. This is the performance win; measure `getIssue` and the discussion page with Server-Timing before and after. Until steps 3–4 ship, the backend **rejects marking content sensitive** (`hasSensitiveContent: true` on any write) **and enabling the sensitive-content gate**. That's safe to ship now because nothing is marked and the gate is off, and it prevents the flags going stale before the write paths maintain them.
3. **Mark at write time:** new nodes under marked content.
4. **Transaction-owned re-evaluation** on the allowed paths, plus the validator (log-only, then enforcing).
5. **Remove the interlock.** Marking content sensitive and enabling the gate work again, now with correct flags.
6. **Just-in-time age check:** the "requires age check" query and the frontend gate.
7. Optional: remove the `ageGateSensitive` `@cypher` fields once nothing references them.

Each step is its own PR.

## Tests

- **Sweep:** per type, a node under marked content is marked, and a node under unmarked content isn't. Parameterized over all six types and their inheritance routes: reply chains, feedback comments, text versions, issue related-ids and files. A dry run writes nothing, and a second run after `--apply` finds no mismatches.
- **Filters:**
  - Restricted viewers don't see marked or inherited content.
  - Allowed viewers see everything.
  - A node with **no** flag property is visible, for all eight types, matching today's `coalesce(…, false)`.
- **API safety:** `ageGateRestricted` appears in no `…CreateInput`/`…UpdateInput`.
- **Interlock (step 2):** marking content sensitive and enabling the gate are rejected, through top-level and nested inputs.
- **Write-time marking (step 3):** each creation path under marked content sets the flag in the same transaction.
- **Re-evaluation (step 4):**
  - Marking or unmarking a discussion or image re-evaluates every descendant in the same transaction, for each allowed path. An injected failure after re-evaluation proves the root change and all flag changes roll back together.
  - Moving an existing node under marked content is re-evaluated atomically on an allowed path, or rejected. This covers every dependency route listed above, including nested inputs.
- **Validator:** unhandled nested writes are rejected, and a CI test fails if a definition uses an uncovered relationship.
- **Just-in-time check:** the "requires age check" query reveals no content fields, and the gate states render for each viewer state.

## Open questions

1. ~~Delay for restricted viewers.~~ Resolved: with "clear unless marked" there's no delay. Unmarked content is visible immediately.
2. **Existing clients using nested dependency writes.** Checked against the frontend so far:
   - The discussion sensitivity toggle uses top-level `updateDiscussions` (allowed).
   - Image uploads use `createImageWithUploader` (allowed).
   - Album edits set `Image.hasSensitiveContent` through nested inputs in `updateDiscussionWithChannelConnections` (allowed; its transaction must cover them).
   - The validator's log-only phase inventories anything else before enforcement.
3. ~~Sweep cadence.~~ Resolved: manual only.
4. **Forum-level marking** (like NSFW subreddits) is a possible later addition. It would add Channel as a root, with channel entries inheriting from it.
