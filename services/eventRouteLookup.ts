import neo4j from "neo4j-driver";

/**
 * Minimal shape shared by a neo4j-driver Session and a managed Transaction:
 * both expose `.run(cypher, params)`.
 */
type CypherRunner = {
  run: (
    cypher: string,
    params: Record<string, unknown>
  ) => Promise<{ records: Array<{ get: (key: string) => unknown }> }>;
};

const EVENT_ID_BY_NUMBER = `
  MATCH (ec:EventChannel {channelUniqueName: $channelUniqueName, eventNumber: $eventNumber})
  RETURN ec.eventId AS eventId
  LIMIT 1
`;

/**
 * Translate a per-forum event number (the short URL id) into the global Event
 * id that the generated `events` query and `getEventComments` key on. Returns
 * null when no event carries that number in the channel.
 */
export const resolveEventIdByNumber = async (
  runner: CypherRunner,
  channelUniqueName: string,
  eventNumber: number
): Promise<string | null> => {
  const result = await runner.run(EVENT_ID_BY_NUMBER, {
    channelUniqueName,
    eventNumber: neo4j.int(eventNumber),
  });
  const raw = result.records[0]?.get("eventId");
  return typeof raw === "string" ? raw : null;
};
