import type { Driver } from "neo4j-driver";

export const coreSchemaConstraints = [
  {
    name: "discussion_channel_unique",
    enterpriseStatement: `CREATE CONSTRAINT discussion_channel_unique IF NOT EXISTS FOR (dc:DiscussionChannel)
      REQUIRE (dc.discussionId, dc.channelUniqueName) IS NODE KEY`,
    communityStatement: `CREATE CONSTRAINT discussion_channel_unique IF NOT EXISTS FOR (dc:DiscussionChannel)
      REQUIRE (dc.discussionId, dc.channelUniqueName) IS UNIQUE`,
  },
  {
    // Per-forum sequential discussion number that backs short URLs
    // (/forums/cats/discussions/42-...). Allocated by ChannelDiscussionCounter.
    name: "discussion_channel_number_unique",
    enterpriseStatement: `CREATE CONSTRAINT discussion_channel_number_unique IF NOT EXISTS FOR (dc:DiscussionChannel)
      REQUIRE (dc.channelUniqueName, dc.discussionNumber) IS NODE KEY`,
    communityStatement: `CREATE CONSTRAINT discussion_channel_number_unique IF NOT EXISTS FOR (dc:DiscussionChannel)
      REQUIRE (dc.channelUniqueName, dc.discussionNumber) IS UNIQUE`,
  },
  {
    name: "channel_discussion_counter_unique",
    enterpriseStatement: `CREATE CONSTRAINT channel_discussion_counter_unique IF NOT EXISTS FOR (counter:ChannelDiscussionCounter)
      REQUIRE counter.channelUniqueName IS NODE KEY`,
    communityStatement: `CREATE CONSTRAINT channel_discussion_counter_unique IF NOT EXISTS FOR (counter:ChannelDiscussionCounter)
      REQUIRE counter.channelUniqueName IS UNIQUE`,
  },
  {
    name: "event_channel_unique",
    enterpriseStatement: `CREATE CONSTRAINT event_channel_unique IF NOT EXISTS FOR (ec:EventChannel)
      REQUIRE (ec.eventId, ec.channelUniqueName) IS NODE KEY`,
    communityStatement: `CREATE CONSTRAINT event_channel_unique IF NOT EXISTS FOR (ec:EventChannel)
      REQUIRE (ec.eventId, ec.channelUniqueName) IS UNIQUE`,
  },
  {
    // Per-forum sequential event number that backs short URLs
    // (/forums/cats/events/7-...). Allocated by ChannelEventCounter.
    name: "event_channel_number_unique",
    enterpriseStatement: `CREATE CONSTRAINT event_channel_number_unique IF NOT EXISTS FOR (ec:EventChannel)
      REQUIRE (ec.channelUniqueName, ec.eventNumber) IS NODE KEY`,
    communityStatement: `CREATE CONSTRAINT event_channel_number_unique IF NOT EXISTS FOR (ec:EventChannel)
      REQUIRE (ec.channelUniqueName, ec.eventNumber) IS UNIQUE`,
  },
  {
    name: "channel_event_counter_unique",
    enterpriseStatement: `CREATE CONSTRAINT channel_event_counter_unique IF NOT EXISTS FOR (counter:ChannelEventCounter)
      REQUIRE counter.channelUniqueName IS NODE KEY`,
    communityStatement: `CREATE CONSTRAINT channel_event_counter_unique IF NOT EXISTS FOR (counter:ChannelEventCounter)
      REQUIRE counter.channelUniqueName IS UNIQUE`,
  },
  {
    name: "issue_channel_issueNumber_unique",
    enterpriseStatement: `CREATE CONSTRAINT issue_channel_issueNumber_unique IF NOT EXISTS FOR (i:Issue)
      REQUIRE (i.channelUniqueName, i.issueNumber) IS NODE KEY`,
    communityStatement: `CREATE CONSTRAINT issue_channel_issueNumber_unique IF NOT EXISTS FOR (i:Issue)
      REQUIRE (i.channelUniqueName, i.issueNumber) IS UNIQUE`,
  },
  {
    name: "issue_channel_discussion_unique",
    enterpriseStatement: `CREATE CONSTRAINT issue_channel_discussion_unique IF NOT EXISTS FOR (i:Issue)
      REQUIRE (i.channelUniqueName, i.relatedDiscussionId) IS UNIQUE`,
    communityStatement: `CREATE CONSTRAINT issue_channel_discussion_unique IF NOT EXISTS FOR (i:Issue)
      REQUIRE (i.channelUniqueName, i.relatedDiscussionId) IS UNIQUE`,
  },
  {
    name: "issue_channel_event_unique",
    enterpriseStatement: `CREATE CONSTRAINT issue_channel_event_unique IF NOT EXISTS FOR (i:Issue)
      REQUIRE (i.channelUniqueName, i.relatedEventId) IS UNIQUE`,
    communityStatement: `CREATE CONSTRAINT issue_channel_event_unique IF NOT EXISTS FOR (i:Issue)
      REQUIRE (i.channelUniqueName, i.relatedEventId) IS UNIQUE`,
  },
  {
    name: "issue_channel_comment_unique",
    enterpriseStatement: `CREATE CONSTRAINT issue_channel_comment_unique IF NOT EXISTS FOR (i:Issue)
      REQUIRE (i.channelUniqueName, i.relatedCommentId) IS UNIQUE`,
    communityStatement: `CREATE CONSTRAINT issue_channel_comment_unique IF NOT EXISTS FOR (i:Issue)
      REQUIRE (i.channelUniqueName, i.relatedCommentId) IS UNIQUE`,
  },
  {
    name: "issue_channel_wiki_revision_unique",
    enterpriseStatement: `CREATE CONSTRAINT issue_channel_wiki_revision_unique IF NOT EXISTS FOR (i:Issue)
      REQUIRE (i.channelUniqueName, i.relatedWikiPageId, i.relatedWikiRevisionId) IS UNIQUE`,
    communityStatement: `CREATE CONSTRAINT issue_channel_wiki_revision_unique IF NOT EXISTS FOR (i:Issue)
      REQUIRE (i.channelUniqueName, i.relatedWikiPageId, i.relatedWikiRevisionId) IS UNIQUE`,
  },
  {
    name: "channel_issue_counter_unique",
    enterpriseStatement: `CREATE CONSTRAINT channel_issue_counter_unique IF NOT EXISTS FOR (counter:ChannelIssueCounter)
      REQUIRE counter.channelUniqueName IS NODE KEY`,
    communityStatement: `CREATE CONSTRAINT channel_issue_counter_unique IF NOT EXISTS FOR (counter:ChannelIssueCounter)
      REQUIRE counter.channelUniqueName IS UNIQUE`,
  },
  {
    name: "server_issue_counter_unique",
    enterpriseStatement: `CREATE CONSTRAINT server_issue_counter_unique IF NOT EXISTS FOR (counter:ServerIssueCounter)
      REQUIRE counter.scope IS NODE KEY`,
    communityStatement: `CREATE CONSTRAINT server_issue_counter_unique IF NOT EXISTS FOR (counter:ServerIssueCounter)
      REQUIRE counter.scope IS UNIQUE`,
  },
  {
    name: "wiki_page_route_unique",
    enterpriseStatement: `CREATE CONSTRAINT wiki_page_route_unique IF NOT EXISTS FOR (page:WikiPage)
      REQUIRE (page.channelUniqueName, page.slug) IS NODE KEY`,
    communityStatement: `CREATE CONSTRAINT wiki_page_route_unique IF NOT EXISTS FOR (page:WikiPage)
      REQUIRE (page.channelUniqueName, page.slug) IS UNIQUE`,
  },
  {
    // Per-user sequential image number that backs short URLs (/u/alice/images/12).
    // Allocated by UserImageCounter, scoped by the uploader. IS UNIQUE (not NODE
    // KEY) because owner-less images carry a null uploadedByUsername.
    name: "image_user_number_unique",
    enterpriseStatement: `CREATE CONSTRAINT image_user_number_unique IF NOT EXISTS FOR (img:Image)
      REQUIRE (img.uploadedByUsername, img.imageNumber) IS UNIQUE`,
    communityStatement: `CREATE CONSTRAINT image_user_number_unique IF NOT EXISTS FOR (img:Image)
      REQUIRE (img.uploadedByUsername, img.imageNumber) IS UNIQUE`,
  },
  {
    name: "user_image_counter_unique",
    enterpriseStatement: `CREATE CONSTRAINT user_image_counter_unique IF NOT EXISTS FOR (counter:UserImageCounter)
      REQUIRE counter.username IS NODE KEY`,
    communityStatement: `CREATE CONSTRAINT user_image_counter_unique IF NOT EXISTS FOR (counter:UserImageCounter)
      REQUIRE counter.username IS UNIQUE`,
  },
  {
    // Per-user sequential album number (/u/alice/albums/3), allocated by
    // UserAlbumCounter. IS UNIQUE because albums not owned by a User are null.
    name: "album_user_number_unique",
    enterpriseStatement: `CREATE CONSTRAINT album_user_number_unique IF NOT EXISTS FOR (a:Album)
      REQUIRE (a.ownerUsername, a.albumNumber) IS UNIQUE`,
    communityStatement: `CREATE CONSTRAINT album_user_number_unique IF NOT EXISTS FOR (a:Album)
      REQUIRE (a.ownerUsername, a.albumNumber) IS UNIQUE`,
  },
  {
    name: "user_album_counter_unique",
    enterpriseStatement: `CREATE CONSTRAINT user_album_counter_unique IF NOT EXISTS FOR (counter:UserAlbumCounter)
      REQUIRE counter.username IS NODE KEY`,
    communityStatement: `CREATE CONSTRAINT user_album_counter_unique IF NOT EXISTS FOR (counter:UserAlbumCounter)
      REQUIRE counter.username IS UNIQUE`,
  },
  {
    // Per-user sequential collection number (/u/alice/collections/5-nature),
    // allocated by UserCollectionCounter. IS UNIQUE (creator-less are null).
    name: "collection_user_number_unique",
    enterpriseStatement: `CREATE CONSTRAINT collection_user_number_unique IF NOT EXISTS FOR (c:Collection)
      REQUIRE (c.ownerUsername, c.collectionNumber) IS UNIQUE`,
    communityStatement: `CREATE CONSTRAINT collection_user_number_unique IF NOT EXISTS FOR (c:Collection)
      REQUIRE (c.ownerUsername, c.collectionNumber) IS UNIQUE`,
  },
  {
    name: "user_collection_counter_unique",
    enterpriseStatement: `CREATE CONSTRAINT user_collection_counter_unique IF NOT EXISTS FOR (counter:UserCollectionCounter)
      REQUIRE counter.username IS NODE KEY`,
    communityStatement: `CREATE CONSTRAINT user_collection_counter_unique IF NOT EXISTS FOR (counter:UserCollectionCounter)
      REQUIRE counter.username IS UNIQUE`,
  },
  {
    name: "channel_role_channel_name_unique",
    enterpriseStatement: `CREATE CONSTRAINT channel_role_channel_name_unique IF NOT EXISTS FOR (role:ChannelRole)
      REQUIRE (role.channelUniqueName, role.name) IS NODE KEY`,
    communityStatement: `CREATE CONSTRAINT channel_role_channel_name_unique IF NOT EXISTS FOR (role:ChannelRole)
      REQUIRE (role.channelUniqueName, role.name) IS UNIQUE`,
  },
  {
    name: "mod_channel_role_channel_name_unique",
    enterpriseStatement: `CREATE CONSTRAINT mod_channel_role_channel_name_unique IF NOT EXISTS FOR (role:ModChannelRole)
      REQUIRE (role.channelUniqueName, role.name) IS NODE KEY`,
    communityStatement: `CREATE CONSTRAINT mod_channel_role_channel_name_unique IF NOT EXISTS FOR (role:ModChannelRole)
      REQUIRE (role.channelUniqueName, role.name) IS UNIQUE`,
  },
] as const;

// Single-field uniqueness constraints that replace the `@unique` directive,
// which @neo4j/graphql 7 removed. `@id` does NOT reliably create a uniqueness
// constraint on current Neo4j versions — that is exactly why `@unique` was
// added to these fields — so we now create them explicitly at startup rather
// than relying on the library's `assertIndexesAndConstraints`. `IS UNIQUE`
// (not NODE KEY) mirrors `@unique` precisely: uniqueness only, with no
// existence requirement (several fields below are nullable). Each tuple is
// [node label, property, optional explicit constraint name]; the two explicit
// names preserve the identifiers that were pinned via `@unique(constraintName:)`.
const singleFieldUniqueConstraints: ReadonlyArray<
  readonly [label: string, property: string, constraintName?: string]
> = [
  ["Image", "id"],
  ["License", "id"],
  ["Purchase", "id"],
  ["FileVersion", "id"],
  ["Collection", "id"],
  ["Album", "id"],
  ["Notification", "id"],
  ["Message", "id"],
  ["Contact", "id"],
  ["User", "username"],
  ["ScratchpadEntry", "id"],
  ["TextVersion", "id"],
  ["LabelChangeHistory", "id"],
  ["WikiPage", "id"],
  ["Suspension", "id"],
  ["DownloadableFile", "id"],
  ["DiscussionFlair", "id"],
  ["Channel", "uniqueName"],
  ["DiscussionChannel", "id"],
  ["Discussion", "id"],
  ["EventChannel", "id"],
  ["RepeatPattern", "id"],
  ["EventSeries", "id"],
  ["RecurringEvent", "id"],
  ["Event", "id"],
  ["Comment", "id"],
  ["Comment", "shortId"],
  ["Emoji", "id"],
  ["Emoji", "name"],
  ["Email", "address"],
  ["ModerationProfile", "displayName"],
  ["ModerationAction", "id"],
  ["ModerationAction", "idempotencyKey", "moderation_action_idempotency_key"],
  ["Issue", "id"],
  ["Feed", "id"],
  ["Tag", "text"],
  ["ServerRole", "name"],
  ["ChannelRole", "id"],
  ["ModChannelRole", "id"],
  ["ModServerRole", "name"],
  ["Plugin", "id"],
  ["PluginVersion", "id"],
  ["ServerSecret", "id"],
  ["PluginPipelineRun", "id"],
  ["PluginPipelineRun", "pipelineId", "plugin_pipeline_run_pipeline_id"],
  ["PluginPipelineCampaign", "id"],
  ["PluginRun", "id"],
  ["ServerConfig", "serverName"],
];

export const singleFieldUniqueConstraintName = (
  label: string,
  property: string,
  constraintName?: string
): string => constraintName ?? `${label}_${property}_unique`.toLowerCase();

// The constraint names these statements create. The schema audit requires
// these so it still verifies the single-field uniqueness constraints that used
// to be library-managed via `@unique` before v7 removed that directive.
export const singleFieldUniqueConstraintNames = singleFieldUniqueConstraints.map(
  ([label, property, constraintName]) =>
    singleFieldUniqueConstraintName(label, property, constraintName)
);

export const singleFieldUniqueConstraintStatements =
  singleFieldUniqueConstraints.map(([label, property, constraintName]) => {
    const name = singleFieldUniqueConstraintName(label, property, constraintName);
    return `CREATE CONSTRAINT ${name} IF NOT EXISTS FOR (n:${label}) REQUIRE n.${property} IS UNIQUE`;
  });

export const getCoreSchemaConstraintStatements = (edition: string) => {
  const statementKey = edition.toLowerCase() === "enterprise"
    ? "enterpriseStatement"
    : "communityStatement";
  return [
    ...coreSchemaConstraints.map((constraint) => constraint[statementKey]),
    ...singleFieldUniqueConstraintStatements,
  ];
};

// Retained for callers that need the strongest form of every constraint.
export const coreSchemaConstraintStatements =
  getCoreSchemaConstraintStatements("enterprise");

export async function ensureCoreSchemaConstraints(
  driver: Driver,
  edition: string
): Promise<void> {
  const session = driver.session();
  try {
    for (const statement of getCoreSchemaConstraintStatements(edition)) {
      await session.run(statement);
    }
  } finally {
    await session.close();
  }
}
