import type { Driver } from "neo4j-driver";

export const coreSchemaConstraints = [
  {
    name: "discussion_channel_unique",
    statement: `CREATE CONSTRAINT discussion_channel_unique IF NOT EXISTS FOR (dc:DiscussionChannel)
      REQUIRE (dc.discussionId, dc.channelUniqueName) IS NODE KEY`,
  },
  {
    name: "event_channel_unique",
    statement: `CREATE CONSTRAINT event_channel_unique IF NOT EXISTS FOR (ec:EventChannel)
      REQUIRE (ec.eventId, ec.channelUniqueName) IS NODE KEY`,
  },
  {
    name: "issue_channel_issueNumber_unique",
    statement: `CREATE CONSTRAINT issue_channel_issueNumber_unique IF NOT EXISTS FOR (i:Issue)
      REQUIRE (i.channelUniqueName, i.issueNumber) IS NODE KEY`,
  },
  {
    name: "issue_channel_discussion_unique",
    statement: `CREATE CONSTRAINT issue_channel_discussion_unique IF NOT EXISTS FOR (i:Issue)
      REQUIRE (i.channelUniqueName, i.relatedDiscussionId) IS UNIQUE`,
  },
  {
    name: "issue_channel_event_unique",
    statement: `CREATE CONSTRAINT issue_channel_event_unique IF NOT EXISTS FOR (i:Issue)
      REQUIRE (i.channelUniqueName, i.relatedEventId) IS UNIQUE`,
  },
  {
    name: "issue_channel_comment_unique",
    statement: `CREATE CONSTRAINT issue_channel_comment_unique IF NOT EXISTS FOR (i:Issue)
      REQUIRE (i.channelUniqueName, i.relatedCommentId) IS UNIQUE`,
  },
  {
    name: "issue_channel_wiki_revision_unique",
    statement: `CREATE CONSTRAINT issue_channel_wiki_revision_unique IF NOT EXISTS FOR (i:Issue)
      REQUIRE (i.channelUniqueName, i.relatedWikiPageId, i.relatedWikiRevisionId) IS UNIQUE`,
  },
  {
    name: "channel_issue_counter_unique",
    statement: `CREATE CONSTRAINT channel_issue_counter_unique IF NOT EXISTS FOR (counter:ChannelIssueCounter)
      REQUIRE counter.channelUniqueName IS NODE KEY`,
  },
  {
    name: "server_issue_counter_unique",
    statement: `CREATE CONSTRAINT server_issue_counter_unique IF NOT EXISTS FOR (counter:ServerIssueCounter)
      REQUIRE counter.scope IS NODE KEY`,
  },
] as const;

export const coreSchemaConstraintStatements = coreSchemaConstraints.map(
  ({ statement }) => statement
);

export async function ensureCoreSchemaConstraints(
  driver: Driver
): Promise<void> {
  const session = driver.session();
  try {
    for (const { statement } of coreSchemaConstraints) {
      await session.run(statement);
    }
  } finally {
    await session.close();
  }
}
