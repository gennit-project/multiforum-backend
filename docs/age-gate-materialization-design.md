# Store the age-gate result on each node: design

Status: **proposal, for review before implementation.**

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

## Goal

Replace the computed check with a **stored property**, so the filter becomes a plain property comparison with no subqueries, **without adding a way for sensitive content to reach a restricted viewer.**

## Design

### 1. Fail closed: store "cleared", not "sensitive"

Each of the six derived types (DiscussionChannel, DownloadableFile, FileVersion, Comment, TextVersion, Issue) gets a stored boolean:

```graphql
ageGateCleared: Boolean   # true = verified not sensitive; null/false = restricted
```

The filter becomes:

```graphql
where: { OR: [{ node: { ageGateCleared: true } }, { jwt: { mayAccessSensitiveContent: true } }] }
```

A node that has never been evaluated (`null`) is **hidden from restricted viewers**. Consequences:

- A write path that forgets to set the flag causes **delayed visibility for restricted viewers**, not a leak. Correctness doesn't depend on hooking every creation path.
- Viewers allowed to see sensitive content, including everyone when the gate is off (today's production setting), are unaffected by the flag.

Discussion and Image keep filtering on their own `hasSensitiveContent`, but it moves out of `@cypher` into a plain property filter (`hasSensitiveContent_NOT: true`, where null means not sensitive, the same as today's `coalesce(…, false)`).

The `ageGateSensitive` `@cypher` fields stay in the schema for now as the **reference definition** that the sweep and the tests compare against. They're just no longer used by `@authorization`.

### 2. Clearing: a sweep plus a fast path

**Sweep (source of truth).** A background service (same pattern as `PluginPipelineWatchdogService`) runs every **10 s**. It evaluates uncleared nodes with the existing `@cypher` statements and sets `ageGateCleared = true` where the result is not sensitive. It runs in batches (`LIMIT 500` per type per tick), newest first. The same sweep does the one-time **backfill**.

**Fast path (latency only).** The paths that create most new content set the flag in the same transaction when the parent is known not to be sensitive:
- comment creation
- the version-history services that create `TextVersion`s
- discussion and channel creation
- downloadable file upload

This only shortens the delay for restricted viewers. Missing a path is harmless, because the sweep clears it within about 10 s.

### 3. Un-clearing when content becomes sensitive (the part that must be exact)

When a Discussion's or Image's `hasSensitiveContent` changes to `true`, every derived node beneath it must lose `ageGateCleared` **in the same transaction**. Otherwise restricted viewers could see it until the next sweep. This is the only leak-relevant path, so it's kept small and explicit:

- **Allowed write paths**, handled by one middleware that runs the un-clear Cypher after the mutation, inside its transaction:
  - `createDiscussionWithChannelConnections`
  - `updateDiscussionWithChannelConnections`
  - `updateDiscussions`
  - `createImageWithUploader`
  - `updateImages`
- **Everything else is rejected.** A validation rule rejects any other mutation whose input sets `hasSensitiveContent`, including nested writes through `@neo4j/graphql`'s relationship inputs, for example `updateChannels { Discussions: { update: { node: { hasSensitiveContent } } } }`. Without this rule, generated nested inputs would make the un-clear path impossible to enumerate.
- **Backstop:** each sweep tick also re-checks a rolling window of *cleared* nodes against the reference definition and un-clears any mismatch, and logs it at `error`, since a mismatch means a path was missed.

Un-clearing is safe to over-apply. At worst, content is hidden briefly until the sweep re-clears it.

Sensitivity changing back to `false` needs no special handling; the sweep re-clears the descendants.

### 4. What stays exactly the same

- The access decision (`mayAccessSensitiveContent`) and the `jwt` claim.
- Custom Cypher resolvers that filter sensitive content directly (`customResolvers/cypher/*`). They keep their own checks; converting them is optional follow-up work.
- Subscription authorization (`@subscriptionsAuthorization`) is jwt-only already.

## Rollout

1. **Ship the property, the sweep and the un-clear middleware and validation, but keep the filters on `ageGateSensitive`.** Let the backfill complete, then compare stored vs computed across all nodes (a verification script, run on production) until there's zero mismatch for 24 h.
2. **Switch the eight `@authorization` filters to the stored properties.** This is the step that removes the planning cost; measure `getIssue` and the discussion page with Server-Timing before and after.
3. Optional: remove the `ageGateSensitive` `@cypher` fields once nothing references them.

Each step is its own PR; step 1 changes no read behavior.

## Tests

- Per type: a node under a sensitive discussion/image is never cleared, and one under a non-sensitive parent is cleared by the sweep. Parameterized over all six types and their inheritance routes (reply chains, feedback comments, issue related-ids).
- Marking a discussion or image sensitive un-clears every descendant within the same mutation, for each allowed path.
- Nested writes of `hasSensitiveContent` through any other mutation are rejected.
- Filter behavior: restricted viewers don't see uncleared nodes, and allowed viewers see everything.
- Integration (testcontainers): the backfill converges and matches the reference definition.

## Open questions for review

1. **Delay for restricted viewers.** New content from paths without the fast path appears to restricted viewers within about 10 s. This only matters on instances with the gate **on**. Acceptable?
2. **Rejecting nested sensitivity writes.** Checked against the frontend so far:
   - The discussion sensitivity toggle uses top-level `updateDiscussions` (allowed).
   - Image uploads use `createImageWithUploader` (allowed).
   - **Album edits may set `Image.hasSensitiveContent` through nested image inputs inside `updateDiscussionWithChannelConnections`.** The album edit form tracks the flag per image. So that allowed path's un-clear step must also cover images changed inside it, not just the discussion. I'll trace the exact input shape before step 1, and nested sensitivity writes anywhere else stay rejected.
3. **Sweep cadence and cost.** 10 s ticks with batch limits are proposed. On topical.space's current data, the full backfill is a few thousand nodes.
