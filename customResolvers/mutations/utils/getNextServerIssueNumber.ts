import neo4j, { Driver } from "neo4j-driver";

/**
 * Atomically increments and returns the next issueNumber for server-scoped issues.
 * Server-scoped issues have channelUniqueName = null and include channel reports.
 * Uses a dedicated counter node for server-scoped issues to avoid race conditions.
 */
const getNextServerIssueNumber = async (driver: Driver): Promise<number> => {
  const session = driver.session();

  try {
    const result = await session.executeWrite((tx) =>
      tx.run(
        `
        MERGE (counter:ServerIssueCounter {scope: 'server'})
        ON CREATE SET counter.current = 0
        WITH counter
        OPTIONAL MATCH (i:Issue) WHERE i.channelUniqueName IS NULL
        WITH counter, coalesce(max(i.issueNumber), 0) AS maxIssueNumber
        SET counter.current = CASE
          WHEN counter.current < maxIssueNumber THEN maxIssueNumber
          ELSE counter.current
        END
        SET counter.current = counter.current + 1
        RETURN counter.current AS issueNumber
      `
      )
    );

    const rawIssueNumber = result.records[0]?.get("issueNumber");
    const issueNumber = neo4j.isInt(rawIssueNumber)
      ? rawIssueNumber.toNumber()
      : (rawIssueNumber as number | null);

    if (typeof issueNumber !== "number" || Number.isNaN(issueNumber)) {
      throw new Error("Failed to generate a server issue number");
    }
    return issueNumber;
  } finally {
    await session.close();
  }
};

export default getNextServerIssueNumber;
