import type { Driver } from "neo4j-driver";

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
        SET counter.current = counter.current + 1
        RETURN counter.current AS issueNumber
      `,
        { channelUniqueName }
      )
    );

    const issueNumber = result.records[0]?.get("issueNumber") as number | null;
    if (typeof issueNumber !== "number" || Number.isNaN(issueNumber)) {
      throw new Error("Failed to generate an issue number");
    }
    return issueNumber;
  } finally {
    await session.close();
  }
};

export default getNextIssueNumber;
