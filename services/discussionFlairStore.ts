import neo4j, { type Record as Neo4jRecord } from "neo4j-driver";

export type DiscussionFlairOption = {
  id: string;
  channelUniqueName: string;
  displayName: string;
  color: string | null;
  order: number;
  archived: boolean;
};

export type ChannelDiscussionFlairConfig = {
  channelUniqueName: string;
  flairRequired: boolean;
  flairs: DiscussionFlairOption[];
};

export type CypherExecutor = {
  run: (
    query: string,
    params?: Record<string, unknown>
  ) => Promise<{ records: Neo4jRecord[] }>;
};

const toNumber = (value: unknown) =>
  neo4j.isInt(value) ? value.toNumber() : Number(value);

export const findChannelDiscussionFlairConfig = async ({
  executor,
  channelUniqueName,
  includeArchived,
}: {
  executor: CypherExecutor;
  channelUniqueName: string;
  includeArchived: boolean;
}): Promise<ChannelDiscussionFlairConfig | null> => {
  const result = await executor.run(
    `
      MATCH (channel:Channel {uniqueName: $channelUniqueName})
      OPTIONAL MATCH (channel)-[:HAS_DISCUSSION_FLAIR]->(flair:DiscussionFlair)
      WHERE $includeArchived
         OR coalesce(flair.archived, false) = false
      WITH channel, flair
      ORDER BY flair.order ASC, flair.displayName ASC
      RETURN channel.uniqueName AS channelUniqueName,
             coalesce(channel.discussionFlairRequired, false) AS flairRequired,
             collect(CASE WHEN flair IS NULL THEN null ELSE {
               id: flair.id,
               channelUniqueName: flair.channelUniqueName,
               displayName: flair.displayName,
               color: flair.color,
               order: flair.order,
               archived: coalesce(flair.archived, false)
             } END) AS flairs
    `,
    {
      channelUniqueName,
      includeArchived,
    }
  );

  const record = result.records[0];
  if (!record) {
    return null;
  }

  return {
    channelUniqueName: record.get("channelUniqueName"),
    flairRequired: record.get("flairRequired"),
    flairs: (record.get("flairs") ?? [])
      .filter(Boolean)
      .map((flair: DiscussionFlairOption & { order: unknown }) => ({
        ...flair,
        order: toNumber(flair.order),
      })),
  };
};
