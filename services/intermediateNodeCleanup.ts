import neo4j, {
  type Driver,
  type ManagedTransaction,
  type Record as Neo4jRecord,
} from "neo4j-driver";

export type ConnectorCleanupCounts = {
  invalid: number;
  repairable: number;
  toQuarantine: number;
  alreadyQuarantined: number;
};

export type IntermediateNodeCleanupReport = {
  applied: boolean;
  discussionChannels: ConnectorCleanupCounts;
  eventChannels: ConnectorCleanupCounts;
  remainingInvalid: {
    discussionChannels: number;
    eventChannels: number;
  };
};

type ConnectorConfig = {
  activeLabel: "DiscussionChannel" | "EventChannel";
  quarantineLabel: "QuarantinedDiscussionChannel" | "QuarantinedEventChannel";
  contentLabel: "Discussion" | "Event";
  contentProperty: "discussionId" | "eventId";
};

const configs: ConnectorConfig[] = [
  {
    activeLabel: "DiscussionChannel",
    quarantineLabel: "QuarantinedDiscussionChannel",
    contentLabel: "Discussion",
    contentProperty: "discussionId",
  },
  {
    activeLabel: "EventChannel",
    quarantineLabel: "QuarantinedEventChannel",
    contentLabel: "Event",
    contentProperty: "eventId",
  },
];

const toNumber = (value: unknown): number =>
  neo4j.isInt(value) ? value.toNumber() : Number(value ?? 0);

const readCounts = (record: Neo4jRecord): ConnectorCleanupCounts => {
  const invalid = toNumber(record.get("invalid"));
  const repairable = toNumber(record.get("repairable"));
  return {
    invalid,
    repairable,
    toQuarantine: invalid - repairable,
    alreadyQuarantined: toNumber(record.get("alreadyQuarantined")),
  };
};

const inspect = async (
  tx: ManagedTransaction,
  config: ConnectorConfig
): Promise<ConnectorCleanupCounts> => {
  const { activeLabel, quarantineLabel, contentLabel, contentProperty } = config;
  const result = await tx.run(`
    MATCH (entry:${activeLabel})
    WITH entry,
      count { (entry)-[:POSTED_IN_CHANNEL]->(:${contentLabel}) } AS contentEndpoints,
      count { (entry)-[:POSTED_IN_CHANNEL]->(:Channel) } AS channelEndpoints,
      count { (:${contentLabel} {id: entry.${contentProperty}}) } AS matchingContent,
      count { (:Channel {uniqueName: entry.channelUniqueName}) } AS matchingChannel
    WHERE contentEndpoints <> 1 OR channelEndpoints <> 1
    WITH count(entry) AS invalid,
      coalesce(sum(CASE
        WHEN contentEndpoints <= 1
          AND channelEndpoints <= 1
          AND (contentEndpoints = 1 OR matchingContent = 1)
          AND (channelEndpoints = 1 OR matchingChannel = 1)
        THEN 1 ELSE 0 END), 0) AS repairable
    OPTIONAL MATCH (quarantined:${quarantineLabel})
    RETURN invalid, repairable, count(quarantined) AS alreadyQuarantined
  `);
  return readCounts(result.records[0]);
};

const repairMissingEndpoint = async (
  tx: ManagedTransaction,
  config: ConnectorConfig,
  endpoint: "content" | "channel"
): Promise<void> => {
  const { activeLabel, contentLabel, contentProperty } = config;
  const targetLabel = endpoint === "content" ? contentLabel : "Channel";
  const targetProperty = endpoint === "content" ? "id" : "uniqueName";
  const sourceProperty = endpoint === "content" ? contentProperty : "channelUniqueName";
  await tx.run(`
    MATCH (entry:${activeLabel})
    WHERE count { (entry)-[:POSTED_IN_CHANNEL]->(:${targetLabel}) } = 0
    OPTIONAL MATCH (candidate:${targetLabel} {${targetProperty}: entry.${sourceProperty}})
    WITH entry, collect(candidate) AS candidates
    WHERE size(candidates) = 1
    UNWIND candidates AS candidate
    MERGE (entry)-[:POSTED_IN_CHANNEL]->(candidate)
  `);
};

const applyCleanup = async (
  tx: ManagedTransaction,
  config: ConnectorConfig
): Promise<void> => {
  await repairMissingEndpoint(tx, config, "content");
  await repairMissingEndpoint(tx, config, "channel");

  const { activeLabel, quarantineLabel, contentLabel } = config;
  await tx.run(`
    MATCH (entry:${activeLabel})
    WHERE count { (entry)-[:POSTED_IN_CHANNEL]->(:${contentLabel}) } <> 1
       OR count { (entry)-[:POSTED_IN_CHANNEL]->(:Channel) } <> 1
    SET entry:${quarantineLabel},
        entry.quarantinedAt = datetime(),
        entry.quarantineReason = 'invalid endpoint cardinality after unique-key repair',
        entry.quarantineSource = 'intermediate-node-cleanup-v1'
    REMOVE entry:${activeLabel}
  `);
};

export async function cleanupIntermediateNodes(
  driver: Driver,
  options: { apply?: boolean } = {}
): Promise<IntermediateNodeCleanupReport> {
  const session = driver.session();
  try {
    return await session.executeWrite(async (tx) => {
      const before: ConnectorCleanupCounts[] = [];
      for (const config of configs) before.push(await inspect(tx, config));
      if (options.apply) {
        for (const config of configs) await applyCleanup(tx, config);
      }
      const after: ConnectorCleanupCounts[] = [];
      for (const config of configs) after.push(await inspect(tx, config));
      return {
        applied: options.apply === true,
        discussionChannels: before[0],
        eventChannels: before[1],
        remainingInvalid: {
          discussionChannels: after[0].invalid,
          eventChannels: after[1].invalid,
        },
      };
    });
  } finally {
    await session.close();
  }
}
