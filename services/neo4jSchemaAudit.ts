import neo4j, { type Driver, type Record as Neo4jRecord } from "neo4j-driver";
import { coreSchemaConstraints } from "./coreSchemaConstraints.js";

export const requiredConstraintNames = coreSchemaConstraints.map(
  ({ name }) => name
);

export const requiredOnlineIndexNames = [
  "discussion_channel_by_channel",
  "channelFulltext",
  "age_gate_touched_comment",
  "age_gate_touched_discussion",
  "age_gate_touched_discussionchannel",
  "age_gate_touched_downloadablefile",
  "age_gate_touched_fileversion",
  "age_gate_touched_image",
  "age_gate_touched_issue",
  "age_gate_touched_textversion",
] as const;

export type IntegrityCounts = {
  discussionChannelsWithInvalidEndpoints: number;
  discussionChannelsWithMismatchedIdentity: number;
  eventChannelsWithInvalidEndpoints: number;
  eventChannelsWithMismatchedIdentity: number;
  commentsWithMultipleParents: number;
  commentsInReplyCycles: number;
  invalidChannelIssueCounters: number;
  invalidServerIssueCounters: number;
};

export type SchemaAuditSnapshot = {
  constraints: string[];
  onlineIndexes: string[];
  integrity: IntegrityCounts;
};

export type SchemaAuditReport = SchemaAuditSnapshot & {
  ok: boolean;
  problems: string[];
};

const toNumber = (value: unknown): number => {
  if (neo4j.isInt(value)) return value.toNumber();
  return typeof value === "number" ? value : 0;
};

export function evaluateSchemaAudit(
  snapshot: SchemaAuditSnapshot
): SchemaAuditReport {
  const constraints = new Set(snapshot.constraints);
  const indexes = new Set(snapshot.onlineIndexes);
  const problems = [
    ...requiredConstraintNames
      .filter((name) => !constraints.has(name))
      .map((name) => `Missing constraint: ${name}`),
    ...requiredOnlineIndexNames
      .filter((name) => !indexes.has(name))
      .map((name) => `Index is missing or not ONLINE: ${name}`),
    ...Object.entries(snapshot.integrity)
      .filter(([, count]) => count > 0)
      .map(([name, count]) => `${name}: ${count}`),
  ];
  return { ...snapshot, ok: problems.length === 0, problems };
}

const firstCount = (records: Neo4jRecord[], key: string): number =>
  toNumber(records[0]?.get(key));

export async function runNeo4jSchemaAudit(
  driver: Driver
): Promise<SchemaAuditReport> {
  const session = driver.session();
  try {
    const constraintsResult = await session.run(
      "SHOW CONSTRAINTS YIELD name RETURN name ORDER BY name"
    );
    const indexesResult = await session.run(
      "SHOW INDEXES YIELD name, state WHERE state = 'ONLINE' RETURN name ORDER BY name"
    );
    const discussionChannels = await session.run(`
      MATCH (entry:DiscussionChannel)
      WHERE count { (entry)-[:POSTED_IN_CHANNEL]->(:Discussion) } <> 1
         OR count { (entry)-[:POSTED_IN_CHANNEL]->(:Channel) } <> 1
      RETURN count(entry) AS count
    `);
    const eventChannels = await session.run(`
      MATCH (entry:EventChannel)
      WHERE count { (entry)-[:POSTED_IN_CHANNEL]->(:Event) } <> 1
         OR count { (entry)-[:POSTED_IN_CHANNEL]->(:Channel) } <> 1
      RETURN count(entry) AS count
    `);
    const discussionChannelIdentityMismatches = await session.run(`
      MATCH (entry:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(discussion:Discussion)
      MATCH (entry)-[:POSTED_IN_CHANNEL]->(channel:Channel)
      WHERE entry.discussionId IS NULL
         OR entry.channelUniqueName IS NULL
         OR entry.discussionId <> discussion.id
         OR entry.channelUniqueName <> channel.uniqueName
      RETURN count(DISTINCT entry) AS count
    `);
    const eventChannelIdentityMismatches = await session.run(`
      MATCH (entry:EventChannel)-[:POSTED_IN_CHANNEL]->(event:Event)
      MATCH (entry)-[:POSTED_IN_CHANNEL]->(channel:Channel)
      WHERE entry.eventId IS NULL
         OR entry.channelUniqueName IS NULL
         OR entry.eventId <> event.id
         OR entry.channelUniqueName <> channel.uniqueName
      RETURN count(DISTINCT entry) AS count
    `);
    const multipleParents = await session.run(`
      MATCH (comment:Comment)-[:IS_REPLY_TO]->()
      WITH comment, count(*) AS parents
      WHERE parents > 1
      RETURN count(comment) AS count
    `);
    const replyCycles = await session.run(`
      MATCH (comment:Comment)-[:IS_REPLY_TO*1..100]->(comment)
      RETURN count(DISTINCT comment) AS count
    `);
    const channelCounterDuplicates = await session.run(`
      MATCH (counter:ChannelIssueCounter)
      WITH counter.channelUniqueName AS key, count(*) AS copies
      WHERE key IS NULL OR copies > 1
      RETURN coalesce(sum(copies), 0) AS count
    `);
    const serverCounterDuplicates = await session.run(`
      MATCH (counter:ServerIssueCounter)
      WITH counter.scope AS key, count(*) AS copies
      WHERE key IS NULL OR copies > 1
      RETURN coalesce(sum(copies), 0) AS count
    `);

    return evaluateSchemaAudit({
      constraints: constraintsResult.records.map((record) => record.get("name")),
      onlineIndexes: indexesResult.records.map((record) => record.get("name")),
      integrity: {
        discussionChannelsWithInvalidEndpoints: firstCount(
          discussionChannels.records,
          "count"
        ),
        discussionChannelsWithMismatchedIdentity: firstCount(
          discussionChannelIdentityMismatches.records,
          "count"
        ),
        eventChannelsWithInvalidEndpoints: firstCount(
          eventChannels.records,
          "count"
        ),
        eventChannelsWithMismatchedIdentity: firstCount(
          eventChannelIdentityMismatches.records,
          "count"
        ),
        commentsWithMultipleParents: firstCount(multipleParents.records, "count"),
        commentsInReplyCycles: firstCount(replyCycles.records, "count"),
        invalidChannelIssueCounters: firstCount(
          channelCounterDuplicates.records,
          "count"
        ),
        invalidServerIssueCounters: firstCount(
          serverCounterDuplicates.records,
          "count"
        ),
      },
    });
  } finally {
    await session.close();
  }
}
