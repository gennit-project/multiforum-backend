import neo4j from "neo4j-driver";

const uri = process.env.NEO4J_URI || "bolt://localhost:7687";
const user = process.env.NEO4J_USER || "neo4j";
const password = process.env.NEO4J_PASSWORD;

if (!password) {
  throw new Error("NEO4J_PASSWORD is required to run the backfill script");
}

const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));

const backfillIssueNumbersForChannel = async (channelUniqueName: string) => {
  const session = driver.session();

  try {
    const result = await session.run(
      `
      MATCH (i:Issue {channelUniqueName: $channelUniqueName})
      WITH i
      ORDER BY i.createdAt ASC, i.id ASC
      WITH collect(i) AS issues
      UNWIND range(0, size(issues) - 1) AS idx
      WITH issues[idx] AS issue, idx
      SET issue.issueNumber = idx + 1
      RETURN count(issue) AS updated
    `,
      { channelUniqueName }
    );

    const updated = result.records[0]?.get("updated");

    await session.run(
      `
      MATCH (i:Issue {channelUniqueName: $channelUniqueName})
      WITH max(i.issueNumber) AS maxNumber
      MERGE (counter:ChannelIssueCounter {channelUniqueName: $channelUniqueName})
      SET counter.current = maxNumber
    `,
      { channelUniqueName }
    );

    console.log(
      `Backfilled ${updated} issues for channel ${channelUniqueName}`
    );
  } finally {
    await session.close();
  }
};

const run = async () => {
  const session = driver.session();
  try {
    const channelsResult = await session.run(
      `MATCH (i:Issue) RETURN DISTINCT i.channelUniqueName AS channel`
    );

    const channels = channelsResult.records
      .map((record) => record.get("channel") as string | null)
      .filter(Boolean) as string[];

    for (const channel of channels) {
      await backfillIssueNumbersForChannel(channel);
    }
  } finally {
    await session.close();
    await driver.close();
  }
};

run()
  .then(() => {
    console.log("Issue number backfill complete");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Issue number backfill failed", error);
    process.exit(1);
  });
