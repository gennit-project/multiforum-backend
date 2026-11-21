import type { Driver } from "neo4j-driver";

/**
 * Backfills the per-forum `eventNumber` that gives events short, human-friendly
 * URLs (/forums/cats/events/7-...). For every channel it numbers the
 * EventChannels that lack a number, in creation order, continuing past any
 * numbers already assigned, then seeds the ChannelEventCounter so new events
 * continue the sequence.
 *
 * Idempotent: only touches EventChannels where eventNumber IS NULL, so it is
 * safe to run on every startup. Must run BEFORE ensureCoreSchemaConstraints
 * creates the (channelUniqueName, eventNumber) NODE KEY, otherwise that
 * constraint rejects the not-yet-numbered nodes. Mirrors
 * discussionNumberBackfill.
 */
const numberValue = (value: unknown): number =>
  typeof (value as { toNumber?: () => number })?.toNumber === "function"
    ? (value as { toNumber: () => number }).toNumber()
    : Number(value ?? 0);

const BACKFILL_QUERY = `
  MATCH (ec:EventChannel)
  WHERE ec.eventNumber IS NULL
  WITH ec.channelUniqueName AS channelUniqueName, ec
  ORDER BY ec.createdAt ASC, ec.id ASC
  WITH channelUniqueName, collect(ec) AS toAssign
  CALL {
    WITH channelUniqueName
    OPTIONAL MATCH (numbered:EventChannel {channelUniqueName: channelUniqueName})
    WHERE numbered.eventNumber IS NOT NULL
    RETURN coalesce(max(numbered.eventNumber), 0) AS startFrom
  }
  UNWIND range(0, size(toAssign) - 1) AS idx
  WITH channelUniqueName, toAssign, startFrom, idx, toAssign[idx] AS ec
  SET ec.eventNumber = startFrom + idx + 1
  WITH channelUniqueName, size(toAssign) AS assignedInChannel, startFrom + size(toAssign) AS newMax
  WITH DISTINCT channelUniqueName, assignedInChannel, newMax
  MERGE (counter:ChannelEventCounter {channelUniqueName: channelUniqueName})
  SET counter.current = CASE WHEN coalesce(counter.current, 0) < newMax THEN newMax ELSE counter.current END
  RETURN count(*) AS channelsUpdated,
         coalesce(sum(assignedInChannel), 0) AS eventChannelsNumbered
`;

export type EventNumberBackfillResult = {
  channelsUpdated: number;
  eventChannelsNumbered: number;
};

export const backfillEventChannelNumbers = async (
  driver: Driver
): Promise<EventNumberBackfillResult> => {
  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    const result = await session.executeWrite((tx) => tx.run(BACKFILL_QUERY));
    const record = result.records[0];
    return {
      channelsUpdated: numberValue(record?.get("channelsUpdated")),
      eventChannelsNumbered: numberValue(record?.get("eventChannelsNumbered")),
    };
  } finally {
    await session.close();
  }
};
