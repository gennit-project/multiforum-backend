import neo4j, { type Driver, type Record as Neo4jRecord } from "neo4j-driver";
import { Kind, type DocumentNode } from "graphql";
import typeDefs from "../typeDefs.js";
import {
  coreSchemaConstraints,
  singleFieldUniqueConstraintNames,
} from "./coreSchemaConstraints.js";
import { criticalPropertyConstraintNames } from "./criticalPropertyConstraints.js";
import { MAX_REPLY_DEPTH } from "./replyAncestry.js";
import { issueTargetDefinitions } from "./issueTargetIdentity.js";

export const getLibraryManagedConstraintNames = (
  definitions: DocumentNode = typeDefs
): string[] => definitions.definitions.flatMap((definition) => {
  if (
    definition.kind !== Kind.OBJECT_TYPE_DEFINITION &&
    definition.kind !== Kind.OBJECT_TYPE_EXTENSION
  ) {
    return [];
  }
  return definition.fields?.flatMap((field) => {
    const unique = field.directives?.find(
      (directive) => directive.name.value === "unique"
    );
    if (!unique) return [];
    const configuredName = unique.arguments?.find(
      (argument) => argument.name.value === "constraintName"
    )?.value;
    return configuredName?.kind === Kind.STRING
      ? [configuredName.value]
      : [`${definition.name.value}_${field.name.value}`];
  }) ?? [];
});

export const requiredConstraintNames = [...new Set([
  ...coreSchemaConstraints.map(({ name }) => name),
  // Single-field uniqueness constraints created explicitly at startup. Before
  // v7 these came from `@unique` and were picked up by
  // getLibraryManagedConstraintNames(); v7 removed `@unique`, so they must be
  // listed from coreSchemaConstraints or the audit stops verifying them.
  ...singleFieldUniqueConstraintNames,
  ...getLibraryManagedConstraintNames(),
])];

export const requiredEnterpriseConstraintNames = [
  ...criticalPropertyConstraintNames,
];

export const getRequiredConstraintNames = (edition: string) => [
  ...requiredConstraintNames,
  ...(edition.toLowerCase().includes("enterprise")
    ? requiredEnterpriseConstraintNames
    : []),
];

export const requiredOnlineIndexNames = [
  // Uniqueness and node-key constraints own backing RANGE indexes with the
  // same name. Requiring them here also verifies that each is ONLINE.
  ...requiredConstraintNames,
  "discussion_channel_by_channel",
  "channelFulltext",
  "discussionFulltext",
  "issueFulltext",
  "wikiPageFulltext",
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
  commentsOverMaxReplyDepth: number;
  invalidChannelIssueCounters: number;
  invalidServerIssueCounters: number;
  discussionFlairsWithInvalidOwners: number;
  discussionFlairsWithStoredChannelUniqueName: number;
  wikiPagesWithInvalidOwners: number;
  wikiPagesWithMismatchedOwners: number;
  invalidWikiPageRoutes: number;
  channelRolesWithInvalidOwners: number;
  channelRolesWithMismatchedOwners: number;
  invalidChannelRoleIdentities: number;
  issuesWithInvalidTargetRelationships: number;
  issuesMissingLiveTargetRelationships: number;
};

export type SchemaAuditSnapshot = {
  edition: string;
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
    ...getRequiredConstraintNames(snapshot.edition)
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
    // Omit a Cypher pre-parser version so edition discovery works against both
    // the repository's Neo4j 5 Community tests and Aura's Cypher 25 runtime.
    const componentsResult = await session.run(
      "CALL dbms.components() YIELD edition RETURN edition LIMIT 1"
    );
    const edition =
      (componentsResult.records[0]?.get("edition") as string | undefined) ??
      "unknown";
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
      MATCH (comment:Comment)-[:IS_REPLY_TO*1..${MAX_REPLY_DEPTH + 1}]->(comment)
      RETURN count(DISTINCT comment) AS count
    `);
    const overDepthReplies = await session.run(`
      MATCH (comment:Comment)-[:IS_REPLY_TO*${MAX_REPLY_DEPTH + 1}]->(:Comment)
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
    const discussionFlairsWithInvalidOwners = await session.run(`
      MATCH (flair:DiscussionFlair)
      WHERE count { (:Channel)-[:HAS_DISCUSSION_FLAIR]->(flair) } <> 1
      RETURN count(flair) AS count
    `);
    const discussionFlairsWithStoredChannelUniqueName = await session.run(`
      MATCH (flair:DiscussionFlair)
      WHERE flair.channelUniqueName IS NOT NULL
      RETURN count(flair) AS count
    `);
    const wikiPagesWithInvalidOwners = await session.run(`
      MATCH (page:WikiPage)
      WHERE count { (:Channel)-[:OWNS_WIKI_PAGE]->(page) } <> 1
      RETURN count(page) AS count
    `);
    const wikiPagesWithMismatchedOwners = await session.run(`
      MATCH (owner:Channel)-[:OWNS_WIKI_PAGE]->(page:WikiPage)
      WHERE page.channelUniqueName IS NULL OR page.channelUniqueName <> owner.uniqueName
      RETURN count(DISTINCT page) AS count
    `);
    const invalidWikiPageRoutes = await session.run(`
      MATCH (page:WikiPage)
      WITH page.channelUniqueName AS channelUniqueName,
           page.slug AS slug,
           count(*) AS copies
      WHERE channelUniqueName IS NULL OR slug IS NULL OR copies > 1
      RETURN coalesce(sum(copies), 0) AS count
    `);
    const channelRolesWithInvalidOwners = await session.run(`
      CALL {
        MATCH (role:ChannelRole)
        RETURN role, 'ChannelRole' AS kind
        UNION ALL
        MATCH (role:ModChannelRole)
        RETURN role, 'ModChannelRole' AS kind
      }
      WITH role, kind
      WHERE (kind = 'ChannelRole' AND count { (:Channel)-[:OWNS_CHANNEL_ROLE]->(role) } <> 1)
         OR (kind = 'ModChannelRole' AND count { (:Channel)-[:OWNS_MOD_CHANNEL_ROLE]->(role) } <> 1)
      RETURN count(role) AS count
    `);
    const channelRolesWithMismatchedOwners = await session.run(`
      CALL {
        MATCH (owner:Channel)-[:OWNS_CHANNEL_ROLE]->(role:ChannelRole)
        RETURN owner, role
        UNION ALL
        MATCH (owner:Channel)-[:OWNS_MOD_CHANNEL_ROLE]->(role:ModChannelRole)
        RETURN owner, role
      }
      WITH owner, role
      WHERE role.channelUniqueName IS NULL OR role.channelUniqueName <> owner.uniqueName
      RETURN count(DISTINCT role) AS count
    `);
    const invalidChannelRoleIdentities = await session.run(`
      CALL {
        MATCH (role:ChannelRole)
        WITH role.channelUniqueName AS channelUniqueName, role.name AS name, count(*) AS copies
        WHERE channelUniqueName IS NULL OR name IS NULL OR copies > 1
        RETURN coalesce(sum(copies), 0) AS count
        UNION ALL
        MATCH (role:ModChannelRole)
        WITH role.channelUniqueName AS channelUniqueName, role.name AS name, count(*) AS copies
        WHERE channelUniqueName IS NULL OR name IS NULL OR copies > 1
        RETURN coalesce(sum(copies), 0) AS count
      }
      RETURN sum(count) AS count
    `);
    const invalidIssueTargetPredicates = issueTargetDefinitions.map(
      (definition) => `
        count { (issue)-[:${definition.relationshipType}]->(:${definition.targetLabel}) } > 1
        OR EXISTS {
          MATCH (issue)-[:${definition.relationshipType}]->(target:${definition.targetLabel})
          WHERE issue.${definition.scalarField} IS NULL
             OR target.${definition.targetKey} <> issue.${definition.scalarField}
        }`
    ).join("\n        OR ");
    const missingIssueTargetPredicates = issueTargetDefinitions.map(
      (definition) => `(
        issue.${definition.scalarField} IS NOT NULL
        AND EXISTS {
          MATCH (target:${definition.targetLabel})
          WHERE target.${definition.targetKey} = issue.${definition.scalarField}
        }
        AND NOT EXISTS {
          MATCH (issue)-[:${definition.relationshipType}]->(:${definition.targetLabel})
        }
      )`
    ).join("\n        OR ");
    const issuesWithInvalidTargetRelationships = await session.run(`
      MATCH (issue:Issue)
      WHERE ${invalidIssueTargetPredicates}
      RETURN count(DISTINCT issue) AS count
    `);
    const issuesMissingLiveTargetRelationships = await session.run(`
      MATCH (issue:Issue)
      WHERE ${missingIssueTargetPredicates}
      RETURN count(DISTINCT issue) AS count
    `);

    return evaluateSchemaAudit({
      edition,
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
        commentsOverMaxReplyDepth: firstCount(
          overDepthReplies.records,
          "count"
        ),
        invalidChannelIssueCounters: firstCount(
          channelCounterDuplicates.records,
          "count"
        ),
        invalidServerIssueCounters: firstCount(
          serverCounterDuplicates.records,
          "count"
        ),
        discussionFlairsWithInvalidOwners: firstCount(
          discussionFlairsWithInvalidOwners.records,
          "count"
        ),
        discussionFlairsWithStoredChannelUniqueName: firstCount(
          discussionFlairsWithStoredChannelUniqueName.records,
          "count"
        ),
        wikiPagesWithInvalidOwners: firstCount(
          wikiPagesWithInvalidOwners.records,
          "count"
        ),
        wikiPagesWithMismatchedOwners: firstCount(
          wikiPagesWithMismatchedOwners.records,
          "count"
        ),
        invalidWikiPageRoutes: firstCount(
          invalidWikiPageRoutes.records,
          "count"
        ),
        channelRolesWithInvalidOwners: firstCount(
          channelRolesWithInvalidOwners.records,
          "count"
        ),
        channelRolesWithMismatchedOwners: firstCount(
          channelRolesWithMismatchedOwners.records,
          "count"
        ),
        invalidChannelRoleIdentities: firstCount(
          invalidChannelRoleIdentities.records,
          "count"
        ),
        issuesWithInvalidTargetRelationships: firstCount(
          issuesWithInvalidTargetRelationships.records,
          "count"
        ),
        issuesMissingLiveTargetRelationships: firstCount(
          issuesMissingLiveTargetRelationships.records,
          "count"
        ),
      },
    });
  } finally {
    await session.close();
  }
}
