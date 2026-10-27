# v7 (@neo4j/graphql 7) frontend contract changes

Campaign #284 migrated the backend from `@neo4j/graphql` v5 to v7. v7 changed the
generated GraphQL surface, so the frontend's operations must be updated to match.
This document lists exactly what the frontend must adopt.

Two confidence levels are flagged:

- **[EXACT]** — a specific shape this backend defines now (verified against the
  running schema / this PR's typeDefs). Adopt verbatim.
- **[CONVENTION]** — a v7-wide rule that applies to many operations. Apply it
  everywhere the frontend builds a `where` / `update` / `sort` / aggregate.
  Much of this was needed by the discussion/event/issue/plugin work earlier in
  the campaign and may already be done; it is listed here for completeness.

---

## 1. Comment creation — new mutation (the one hard break) **[EXACT]**

The generated `createComments` mutation is now **permission-denied** (it can no
longer carry a comment's to-one relationships — v7 removed to-one `connect` from
create inputs). Comment creation moves to a custom owned-write mutation:

```graphql
createCommentWithOwnedConnections(
  input: [OwnedCommentCreateInput!]!
): CreateCommentsWithOwnedConnectionsResponse!
```

### Input — `OwnedCommentCreateInput`

The input **keeps the same connect shape** the old `createComments` call used, so
for most call sites this is a rename of the mutation + input type, not a
restructure.

```graphql
input OwnedCommentCreateInput {
  text: String
  isRootComment: Boolean!
  isFeedbackComment: Boolean
  botMentions: String
  CommentAuthor: OwnedCommentAuthorConnect          # to-one union (User | ModerationProfile)
  DiscussionChannel: OwnedCommentToOneConnect       # root comment on a discussion-in-channel
  Event: OwnedCommentToOneConnect                   # comment on an event
  Channel: OwnedCommentToOneConnect                 # comment on a channel
  ParentComment: OwnedCommentToOneConnect           # reply
  GivesFeedbackOnComment: OwnedCommentToOneConnect  # feedback comment
  GivesFeedbackOnDiscussion: OwnedCommentToOneConnect
  GivesFeedbackOnEvent: OwnedCommentToOneConnect
  UpvotedByUsers: OwnedCommentToManyConnect         # author self-upvote (to-many connect)
  SubscribedToNotifications: OwnedCommentToManyConnect # notification auto-subscribe (to-many connect)
}

# To-many connect is a LIST: { connect: [{ where: { node: { username } } }] }
input OwnedCommentToManyConnect { connect: [OwnedCommentConnect!] }

input OwnedCommentAuthorConnect {
  User: OwnedCommentToOneConnect
  ModerationProfile: OwnedCommentToOneConnect
}
input OwnedCommentToOneConnect { connect: OwnedCommentConnect }
input OwnedCommentConnect { where: OwnedCommentConnectWhere }
input OwnedCommentConnectWhere { node: OwnedCommentConnectNode }
input OwnedCommentConnectNode {
  id: ID            # DiscussionChannel / Event / ParentComment / GivesFeedbackOn* targets
  username: String  # CommentAuthor.User
  displayName: String # CommentAuthor.ModerationProfile
  uniqueName: String  # Channel
}
```

Notes:

- The connect leaf is a **plain value** (`{ node: { id: "..." } }`), **not** the
  v7 filter form `{ id: { eq } }`. This is a custom input the resolver parses, so
  it intentionally keeps the pre-v7 connect shape.
- Supply exactly the relationships that applied before (e.g. a reply: `text`,
  `isRootComment: false`, `ParentComment`, and usually `CommentAuthor` +
  `DiscussionChannel`). Any to-one whose endpoint is missing is a no-op.
- Scalar fields accepted today: `text`, `isRootComment`, `isFeedbackComment`,
  `botMentions`. If the frontend sends other comment scalars on create, tell the
  backend — they need to be added to `OwnedCommentCreateInput` explicitly.

### Response — unchanged shape

```graphql
type CreateCommentsWithOwnedConnectionsResponse {
  comments: [Comment!]!
}
```

Select on `.comments { ... }` exactly as before. All `Comment` fields
(scalars + relationships) resolve normally.

### Before / after

```graphql
# BEFORE (v5)
mutation {
  createComments(input: [{
    text: "nice",
    isRootComment: true,
    DiscussionChannel: { connect: { where: { node: { id: "dc-1" } } } },
    CommentAuthor: { User: { connect: { where: { node: { username: "alice" } } } } }
  }]) { comments { id text } }
}

# AFTER (v7)
mutation {
  createCommentWithOwnedConnections(input: [{
    text: "nice",
    isRootComment: true,
    DiscussionChannel: { connect: { where: { node: { id: "dc-1" } } } },
    CommentAuthor: { User: { connect: { where: { node: { username: "alice" } } } } }
  }]) { comments { id text } }
}
```

`updateComments` and `deleteComments` are **unchanged** (still generated) — only
creation moved. (`updateComments` still follows the v7 `{ set: }` update
convention below.)

---

## 2. Generated create mutations are denied — use the custom write mutations **[EXACT]**

v7 removed to-one connect from create/update inputs, so the generated bulk
create mutations that relied on it are permission-denied. Use these instead:

| Instead of (generated, denied) | Use (custom)                               |
| ------------------------------ | ------------------------------------------ |
| `createComments`               | `createCommentWithOwnedConnections`        |
| `createDiscussions`            | `createDiscussionWithChannelConnections`   |
| `updateDiscussions` (rel. writes) | `updateDiscussionWithChannelConnections` |
| `createEvents`                 | `createEventWithChannelConnections`        |
| `updateEvents` (rel. writes)   | `updateEventWithChannelConnections` / `updateEventInSeries` |
| event series create            | `createEventSeriesWithChannelConnections`  |

The discussion/event ones already existed pre-this-PR; `createCommentWithOwnedConnections`
is the new one. If the frontend already uses the discussion/event custom
mutations, only the comment path is new.

---

## 3. v7-wide GraphQL conventions **[CONVENTION]**

Apply these to every operation the frontend sends. (Generated reads/filters/
updates all changed shape in v7.)

### 3a. Filters use explicit operators

```graphql
# v5                         # v7
where: { id: "x" }           where: { id: { eq: "x" } }
where: { name: "x" }         where: { name: { eq: "x" } }
where: { id_IN: [...] }      where: { id: { in: [...] } }
where: { title_CONTAINS: "x" }   where: { title: { contains: "x" } }
where: { title_STARTS_WITH: "x" } where: { title: { startsWith: "x" } }
where: { count_GT: 3 }       where: { count: { gt: 3 } }   # gt/gte/lt/lte
where: { field_NOT: "x" }    where: { NOT: { field: { eq: "x" } } }
where: { Rel_SOME: {...} }   where: { Rel: { some: {...} } } # some/all/none/single
```

A bare `{ id: {} }` is now a **valid empty filter** (matches all). A type
mismatch reports `Expected type <T>ScalarFilters to be an object`.

### 3b. Scalar updates wrap in `{ set: ... }`

```graphql
# v5                              # v7
update: { title: "New" }          update: { title: { set: "New" } }
update: { locked: true }          update: { locked: { set: true } }
update: { field: null }           update: { field: { set: null } }
```

### 3c. Sort / pagination are direct args (`options` removed)

```graphql
# v5                                          # v7
discussions(options: { sort: [{ createdAt: DESC }], limit: 10, offset: 20 })
discussions(sort: [{ createdAt: DESC }], limit: 10, offset: 20)
```

The `options` argument and the `*Options` input types no longer exist.

### 3d. Aggregations move under `*Connection`

```graphql
# v5                                  # v7
NotificationsAggregate { count }      NotificationsConnection { aggregate { count { nodes } } }
```

Top-level `{plural}Aggregate` root queries (e.g. `discussionsAggregate`) were
removed; use `{plural}Connection { aggregate { count { nodes } } }`.

### 3e. `connectOrCreate` removed

Replace nested `connectOrCreate` with a `connect` (existing) or `create` (new),
or route through the relevant custom owned-write mutation.

### 3f. To-one `connect` / `disconnect` removed from create & update inputs

This is the root reason for §1–§2. Any remaining generated create/update that
nested a to-one `connect`/`disconnect` must move to a custom mutation; the
backend owns those edges server-side.

---

## 4. Reads: some to-one relationships are now nullable **[EXACT]**

These to-one fields were non-null (`!`) on `main` and are **nullable** now, so a
corrupt/legacy node can read them back as `null`. Frontend reads must tolerate
null (don't assume presence):

- `WikiPage.Channel`
- `DiscussionFlair.Channel`
- `ChannelRole.Owner`, `ModChannelRole.Owner`
- `Collection.CreatedBy`
- `ScratchpadEntry.Author`

(Several other `Channel` to-one fields — `DiscussionChannel.Channel`,
`EventChannel.Channel`, `Issue.Channel/TargetChannel` — were already nullable
before this campaign; no change.)

---

## 5. Not changed

- Subscriptions remain unused (no websocket client); no in-process events to
  consume. If subscriptions are adopted later, v7 uses CDC.
- Read selection sets for existing fields are unchanged except where §3d/§4 apply.
- `updateComments` / `deleteComments` / most generated single-type reads keep
  their names; only their `where` / `update` shapes follow §3.

---

## Resolved during the frontend slice

- **Comment scalar fields** — the frontend sends only `text`, `isRootComment`,
  `isFeedbackComment` on create; all already accepted, no backend change needed.
- **To-many connects** — the frontend also sends `UpvotedByUsers` (author
  self-upvote) and `SubscribedToNotifications` (auto-subscribe) as to-many
  connects. The backend `OwnedCommentCreateInput` now accepts both (see the
  `OwnedCommentToManyConnect` above) and owns the `UPVOTED_COMMENT` /
  `SUBSCRIBED_TO_NOTIFICATIONS` edges; covered by
  `tests/integration/createCommentWithOwnedConnections.test.ts`.
