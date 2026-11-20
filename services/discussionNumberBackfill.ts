import type { Driver } from "neo4j-driver";

/**
 * Backfills the per-forum `discussionNumber` that gives discussions short,
 * human-friendly URLs (/forums/cats/discussions/42-...). For every channel it
 * numbers the DiscussionChannels that lack a number, in creation order,
 * continuing past any numbers already assigned, then seeds the
 * ChannelDiscussionCounter so new discussions continue the sequence.
 *
 * Idempotent: only touches DiscussionChannels where discussionNumber IS NULL,
 * so it is safe to run on every startup. Must run BEFORE
 * ensureCoreSchemaConstraints creates the (channelUniqueName, discussionNumber)
 * NODE KEY, otherwise that constraint rejects the not-yet-numbered nodes.
 */
const numberValue = (value: unknown): number =>
  typeof (value as { toNumber?: () => number })?.toNumber === "function"
    ? (value as { toNumber: () => number }).toNumber()
    : Number(value ?? 0);

const BACKFILL_QUERY = `
  MATCH (dc:DiscussionChannel)
  WHERE dc.discussionNumber IS NULL
  WITH dc.channelUniqueName AS channelUniqueName, dc
  ORDER BY dc.createdAt ASC, dc.id ASC
  WITH channelUniqueName, collect(dc) AS toAssign
  CALL {
    WITH channelUniqueName
    OPTIONAL MATCH (numbered:DiscussionChannel {channelUniqueName: channelUniqueName})
    WHERE numbered.discussionNumber IS NOT NULL
    RETURN coalesce(max(numbered.discussionNumber), 0) AS startFrom
  }
  UNWIND range(0, size(toAssign) - 1) AS idx
  WITH channelUniqueName, toAssign, startFrom, idx, toAssign[idx] AS dc
  SET dc.discussionNumber = startFrom + idx + 1
  WITH channelUniqueName, size(toAssign) AS assignedInChannel, startFrom + size(toAssign) AS newMax
  WITH DISTINCT channelUniqueName, assignedInChannel, newMax
  MERGE (counter:ChannelDiscussionCounter {channelUniqueName: channelUniqueName})
  SET counter.current = CASE WHEN coalesce(counter.current, 0) < newMax THEN newMax ELSE counter.current END
  RETURN count(*) AS channelsUpdated,
         coalesce(sum(assignedInChannel), 0) AS discussionChannelsNumbered
`;

export type DiscussionNumberBackfillResult = {
  channelsUpdated: number;
  discussionChannelsNumbered: number;
};

export const backfillDiscussionChannelNumbers = async (
  driver: Driver
): Promise<DiscussionNumberBackfillResult> => {
  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    const result = await session.executeWrite((tx) => tx.run(BACKFILL_QUERY));
    const record = result.records[0];
    return {
      channelsUpdated: numberValue(record?.get("channelsUpdated")),
      discussionChannelsNumbered: numberValue(
        record?.get("discussionChannelsNumbered")
      ),
    };
  } finally {
    await session.close();
  }
};
