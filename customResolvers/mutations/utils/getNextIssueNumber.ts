import neo4j, { Driver } from "neo4j-driver";

/**
 * Atomically increments and returns the next issueNumber for a channel.
 * Uses a dedicated counter node per channel to avoid race conditions.
 */
const getNextIssueNumber = async (
  driver: Driver,
  channelUniqueName: string
): Promise<number> => {
  if (!channelUniqueName) {
    throw new Error("channelUniqueName is required to generate an issue number");
  }

  const session = driver.session();

  try {
    const result = await session.executeWrite((tx) =>
      tx.run(
        `
        MERGE (counter:ChannelIssueCounter {channelUniqueName: $channelUniqueName})
        ON CREATE SET counter.current = 0
        WITH counter
        MATCH (i:Issue {channelUniqueName: $channelUniqueName})
        WITH counter, coalesce(max(i.issueNumber), 0) AS maxIssueNumber
        SET counter.current = CASE
          WHEN counter.current < maxIssueNumber THEN maxIssueNumber
          ELSE counter.current
        END
        SET counter.current = counter.current + 1
        RETURN counter.current AS issueNumber
      `,
        { channelUniqueName }
      )
    );

    const rawIssueNumber = result.records[0]?.get("issueNumber");
    const issueNumber = neo4j.isInt(rawIssueNumber)
      ? rawIssueNumber.toNumber()
      : (rawIssueNumber as number | null);

    if (typeof issueNumber !== "number" || Number.isNaN(issueNumber)) {
      throw new Error("Failed to generate an issue number");
    }
    return issueNumber;
  } finally {
    await session.close();
  }
};

export default getNextIssueNumber;
