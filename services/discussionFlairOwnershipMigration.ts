import type { Driver, Record as Neo4jRecord } from "neo4j-driver";

export type DiscussionFlairOwnershipRecord = {
  id: string;
  storedChannelUniqueName: string | null;
  ownerChannelUniqueNames: string[];
};

export type DiscussionFlairOwnershipReport = {
  records: DiscussionFlairOwnershipRecord[];
  orphaned: DiscussionFlairOwnershipRecord[];
  multiplyOwned: DiscussionFlairOwnershipRecord[];
  mismatched: DiscussionFlairOwnershipRecord[];
  storedPropertyCount: number;
};

type Executor = {
  run: (
    query: string,
    params?: Record<string, unknown>
  ) => Promise<{ records: Neo4jRecord[] }>;
};

const inspectDiscussionFlairOwnership = async (
  executor: Executor
): Promise<DiscussionFlairOwnershipReport> => {
  const result = await executor.run(`
    MATCH (flair:DiscussionFlair)
    OPTIONAL MATCH (owner:Channel)-[:HAS_DISCUSSION_FLAIR]->(flair)
    WITH flair, owner
    ORDER BY owner.uniqueName
    WITH flair,
         [name IN collect(DISTINCT owner.uniqueName) WHERE name IS NOT NULL] AS ownerChannelUniqueNames
    RETURN flair.id AS id,
           flair.channelUniqueName AS storedChannelUniqueName,
           ownerChannelUniqueNames
    ORDER BY id
  `);

  const records = result.records.map((record) => ({
    id: record.get("id") as string,
    storedChannelUniqueName:
      (record.get("storedChannelUniqueName") as string | null) ?? null,
    ownerChannelUniqueNames:
      (record.get("ownerChannelUniqueNames") as string[] | null) ?? [],
  }));

  return {
    records,
    orphaned: records.filter(
      (record) => record.ownerChannelUniqueNames.length === 0
    ),
    multiplyOwned: records.filter(
      (record) => record.ownerChannelUniqueNames.length > 1
    ),
    mismatched: records.filter(
      (record) =>
        record.storedChannelUniqueName !== null &&
        (record.ownerChannelUniqueNames.length !== 1 ||
          record.ownerChannelUniqueNames[0] !== record.storedChannelUniqueName)
    ),
    storedPropertyCount: records.filter(
      (record) => record.storedChannelUniqueName !== null
    ).length,
  };
};

export const auditDiscussionFlairOwnership = async (
  driver: Driver
): Promise<DiscussionFlairOwnershipReport> => {
  const session = driver.session({ defaultAccessMode: "READ" });
  try {
    return await inspectDiscussionFlairOwnership(session);
  } finally {
    await session.close();
  }
};

export const migrateDiscussionFlairOwnership = async (
  driver: Driver
): Promise<DiscussionFlairOwnershipReport & { removedStoredProperties: number }> => {
  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    return await session.executeWrite(async (transaction) => {
      const report = await inspectDiscussionFlairOwnership(transaction);
      if (report.orphaned.length > 0 || report.multiplyOwned.length > 0) {
        throw new Error(
          "Cannot remove DiscussionFlair.channelUniqueName while orphaned or multiply-owned flairs exist."
        );
      }

      const result = await transaction.run(`
        MATCH (flair:DiscussionFlair)
        WHERE flair.channelUniqueName IS NOT NULL
        REMOVE flair.channelUniqueName
        RETURN count(flair) AS removedStoredProperties
      `);

      return {
        ...report,
        removedStoredProperties:
          result.records[0]?.get("removedStoredProperties")?.toNumber?.() ??
          Number(result.records[0]?.get("removedStoredProperties") ?? 0),
      };
    });
  } finally {
    await session.close();
  }
};
