import type { Driver, Record as Neo4jRecord } from "neo4j-driver";

export type WikiPageOwnershipRecord = {
  id: string;
  slug: string | null;
  storedChannelUniqueName: string | null;
  ownerChannelUniqueNames: string[];
  ownerRelationshipCount: number;
  matchingChannelCount: number;
};

export type WikiPageOwnershipReport = {
  records: WikiPageOwnershipRecord[];
  orphaned: WikiPageOwnershipRecord[];
  missingChannels: WikiPageOwnershipRecord[];
  multiplyOwned: WikiPageOwnershipRecord[];
  mismatched: WikiPageOwnershipRecord[];
  missingRouteIdentity: WikiPageOwnershipRecord[];
  duplicateRoutes: Array<{
    channelUniqueName: string;
    slug: string;
    ids: string[];
  }>;
};

type Executor = {
  run: (
    query: string,
    params?: Record<string, unknown>
  ) => Promise<{ records: Neo4jRecord[] }>;
};

const numberValue = (value: unknown) =>
  typeof (value as { toNumber?: () => number })?.toNumber === "function"
    ? (value as { toNumber: () => number }).toNumber()
    : Number(value ?? 0);

const inspect = async (executor: Executor): Promise<WikiPageOwnershipReport> => {
  const pages = await executor.run(`
    MATCH (page:WikiPage)
    OPTIONAL MATCH (owner:Channel)-[:OWNS_WIKI_PAGE]->(page)
    WITH page,
         [name IN collect(DISTINCT owner.uniqueName) WHERE name IS NOT NULL] AS ownerChannelUniqueNames,
         count(owner) AS ownerRelationshipCount
    OPTIONAL MATCH (matchingChannel:Channel {uniqueName: page.channelUniqueName})
    RETURN page.id AS id,
           page.slug AS slug,
           page.channelUniqueName AS storedChannelUniqueName,
           ownerChannelUniqueNames,
           ownerRelationshipCount,
           count(matchingChannel) AS matchingChannelCount
    ORDER BY id
  `);
  const duplicateRoutesResult = await executor.run(`
    MATCH (page:WikiPage)
    WHERE page.channelUniqueName IS NOT NULL AND page.slug IS NOT NULL
    WITH page.channelUniqueName AS channelUniqueName,
         page.slug AS slug,
         collect(page.id) AS ids
    WHERE size(ids) > 1
    RETURN channelUniqueName, slug, ids
    ORDER BY channelUniqueName, slug
  `);
  const records = pages.records.map((record) => ({
    id: record.get("id") as string,
    slug: (record.get("slug") as string | null) ?? null,
    storedChannelUniqueName:
      (record.get("storedChannelUniqueName") as string | null) ?? null,
    ownerChannelUniqueNames:
      (record.get("ownerChannelUniqueNames") as string[] | null) ?? [],
    ownerRelationshipCount: numberValue(record.get("ownerRelationshipCount")),
    matchingChannelCount: numberValue(record.get("matchingChannelCount")),
  }));

  return {
    records,
    orphaned: records.filter((record) => record.ownerChannelUniqueNames.length === 0),
    missingChannels: records.filter(
      (record) => record.storedChannelUniqueName !== null && record.matchingChannelCount !== 1
    ),
    multiplyOwned: records.filter((record) => record.ownerRelationshipCount > 1),
    mismatched: records.filter(
      (record) =>
        record.ownerChannelUniqueNames.length === 1 &&
        record.ownerChannelUniqueNames[0] !== record.storedChannelUniqueName
    ),
    missingRouteIdentity: records.filter(
      (record) => record.storedChannelUniqueName === null || record.slug === null
    ),
    duplicateRoutes: duplicateRoutesResult.records.map((record) => ({
      channelUniqueName: record.get("channelUniqueName") as string,
      slug: record.get("slug") as string,
      ids: record.get("ids") as string[],
    })),
  };
};

export const auditWikiPageOwnership = async (driver: Driver) => {
  const session = driver.session({ defaultAccessMode: "READ" });
  try {
    return await inspect(session);
  } finally {
    await session.close();
  }
};

export const migrateWikiPageOwnership = async (driver: Driver) => {
  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    return await session.executeWrite(async (transaction) => {
      const report = await inspect(transaction);
      if (
        report.missingChannels.length ||
        report.multiplyOwned.length ||
        report.mismatched.length ||
        report.missingRouteIdentity.length ||
        report.duplicateRoutes.length
      ) {
        throw new Error(
          "Cannot backfill wiki ownership until missing channels, ambiguous owners, mismatches, missing route identity, and duplicate routes are resolved."
        );
      }
      const result = await transaction.run(`
        MATCH (page:WikiPage)
        WHERE NOT (:Channel)-[:OWNS_WIKI_PAGE]->(page)
        MATCH (channel:Channel {uniqueName: page.channelUniqueName})
        MERGE (channel)-[:OWNS_WIKI_PAGE]->(page)
        RETURN count(page) AS linkedPages
      `);
      return {
        ...report,
        linkedPages: numberValue(result.records[0]?.get("linkedPages")),
      };
    });
  } finally {
    await session.close();
  }
};
