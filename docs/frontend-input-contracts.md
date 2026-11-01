# Frontend #700 input contracts

Companion contract for multiforum-nuxt draft #707. These operations fix the eleven
coercion exceptions recorded at frontend commit
`9af86915d82c5476caf18dd5507b905f92c0f3f4`. They require a coordinated backend release;
merging frontend types alone does not make the mutations available on an older server.

## Crossposts

Keep `createDiscussionWithChannelConnections` and its existing
`DiscussionCreateInputWithChannels` wrapper. Add optional
`crosspostedDiscussionId: ID` alongside `discussionCreateInput` and
`channelConnections`. Remove `discussionCreateInput.CrosspostedDiscussion.connect`.
The reference must identify an existing, non-deleted discussion visible under the
caller's sensitive-content policy. Nested crosspost creation and the ID cannot be
combined. The authenticated author, reference, channel relationships and new node
are written in one transaction. The existing create/feature/channel permissions apply.

## Albums (all four update call sites)

Use `updateDiscussionWithChannelConnections`, including for the two call sites
currently using generated `updateDiscussions`. Retain the existing discussion
edit gate. Add an optional `album: DiscussionAlbumInput` argument:

```graphql
input DiscussionAlbumInput {
  imageIds: [ID!]!
  imageUpdates: [DiscussionAlbumImageUpdateInput!]
}
input DiscussionAlbumImageUpdateInput {
  id: ID!
  alt: String
  caption: String
  copyright: String
}
```

`imageIds` is the complete ordered membership list. Omission or null of `album`
leaves it unchanged; `{imageIds: []}` clears it. Images are uploaded first through
the existing authenticated upload mutation. IDs must be unique, available and
visible to the caller. Connecting an image never grants uploader ownership.
Only the uploader can edit its metadata, including when a discussion moderator
is editing an album. Do not send unchanged metadata for other uploaders' images.
URLs and upload/audit/scanning fields are not editable here. An omitted metadata
field is unchanged; explicit null clears that field.

The `where` must be exactly `{id: {eq: discussionId}}`. Do not combine `album`
with `albumImageDisconnections`; absence from `imageIds` disconnects an image.
Membership, ordering, metadata and ordinary discussion scalar changes share one
transaction. A rejected reference or metadata edit rolls back all of them.
Inline creation preserves existing image uploader relationships too; its image
connections must use exact `where.node.id.eq` filters.

## Issue creation

Change the operation variable from `IssueCreateInput!` to `SubmitIssueInput!`.
Required fields are `title` and `body`; `channelUniqueName` is optional (omit for
server scope). `asModerationProfile: Boolean` defaults false and selects only the
profile belonging to the authenticated user. Remove `Author`, `authorName`,
`Channel`, `issueNumber`, `isOpen` and `flaggedServerRuleViolation` from variables.
New requests are open and not flagged; identity and numbering are server assigned.

Generic forum/server requests require no fabricated target. Optional typed
`related*` target fields are supported; incompatible or missing references fail
before numbering. Forum-scoped content targets must belong to that forum; content and an additional
author target cannot be combined. Wiki revision targets must belong to their named wiki page.
Creation, identity relationships and the existing forum/server counter increment
commit atomically. Responses include `id`, `issueNumber`, `channelUniqueName`,
`Channel`, authenticated `Author`, timestamps and the existing form selections.

## Wiki creation, child creation and editing

Use `writeWikiPage(input: WriteWikiPageInput!): WikiPage!`:

```graphql
input WriteWikiPageInput {
  id: ID
  channelUniqueName: String!
  slug: String
  parentId: ID
  title: String!
  body: String
  editReason: String
  setAsHome: Boolean = false
}
```

For creation omit `id` and provide `slug`; optionally provide `parentId` and/or
`setAsHome`. For editing provide `id`, `channelUniqueName`, and the complete new
`title`/`body`; omit `slug` and `parentId` because identity is immutable. Omitted
body means null, not "leave unchanged". Remove all client author relationships.
The result contains navigation `id`/`slug`, original/current authors and revisions.

Use `setWikiHomePage(channelUniqueName: String!, pageId: ID!): Boolean!` when
linking an already-created page without editing it. Home and parent pages must
belong to the named channel. Existing wiki-enabled, channel permission and locked
page moderation checks apply. The server assigns the editor from authenticated
context. Previous changed title/body content retains its previous editor in
`PastVersions`. Creation and changed current text also receive authored revisions
immediately, so contributions and revision reports do not wait for another edit.
All revision writes commit with the edit; unchanged text does not reassign its editor. A legacy page with
missing editor attribution must be repaired before its text can be changed;
the mutation does not invent a historical author.

## Verification and schema delivery

`tests/integration/frontendInputContracts.test.ts` executes these requests through
the augmented schema, graphql-shield and issue middleware against disposable
Neo4j. It covers coercion, positive and negative permissions, reference/ownership
checks, rollback, generic scopes and wiki history. Related persistence tests
cover the existing ownership and identity writers.

After committing, `pnpm schema:export` produces `schema.graphql` and
`manifest.json` at `artifacts/graphql-schema/`. CI uploads them together as
`graphql-schema-<checkout SHA>`; PR CI records the synthetic merge revision.
The artifact manifest is the source of truth for pinning. Alternatively, check
out the exact backend source commit, install the frozen lockfile and export the
same contract locally. Do not copy only the SDL without its provenance manifest.
