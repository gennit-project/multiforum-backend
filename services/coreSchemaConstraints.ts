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
    name: "event_channel_unique",
    enterpriseStatement: `CREATE CONSTRAINT event_channel_unique IF NOT EXISTS FOR (ec:EventChannel)
      REQUIRE (ec.eventId, ec.channelUniqueName) IS NODE KEY`,
    communityStatement: `CREATE CONSTRAINT event_channel_unique IF NOT EXISTS FOR (ec:EventChannel)
      REQUIRE (ec.eventId, ec.channelUniqueName) IS UNIQUE`,
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
] as const;

export const getCoreSchemaConstraintStatements = (edition: string) => {
  const statementKey = edition.toLowerCase() === "enterprise"
    ? "enterpriseStatement"
    : "communityStatement";
  return coreSchemaConstraints.map((constraint) => constraint[statementKey]);
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
