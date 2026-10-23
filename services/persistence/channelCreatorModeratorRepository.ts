import neo4j, { type Driver } from "neo4j-driver";
import { resolveNeo4jDatabase } from "../neo4jDatabase.js";

// v7 no longer exports a `SubscriptionsEvent` type; the relationship event this
// repository emits is hand-serialized, so its shape is described locally.
export type CreatorModeratorRelationshipEvent = {
  event: "create_relationship";
  relationshipName: string;
  fromTypename: string;
  toTypename: string;
  id: string;
  id_from: string;
  id_to: string;
  timestamp: number;
  properties: {
    from: Record<string, unknown>;
    to: Record<string, unknown>;
    relationship: Record<string, unknown>;
  };
};

export interface ChannelCreatorModeratorRepository {
  connect(channelUniqueName: string, displayName: string): Promise<CreatorModeratorRelationshipEvent | null>;
}

// Both endpoint keys are @unique. Binding both nodes before MERGE also lets
// Neo4j lock/recheck the relationship when concurrent callers connect the pair.
export const CONNECT_CREATOR_MODERATOR_QUERY = `
  MATCH (channel:Channel {uniqueName: $channelUniqueName})
  MATCH (profile:ModerationProfile {displayName: $displayName})
  MERGE (profile)-[edge:MODERATOR_OF_CHANNEL]->(channel)
  RETURN id(edge) AS id, id(profile) AS id_from, id(channel) AS id_to,
         timestamp() AS timestamp, properties(profile) AS fromProperties,
         properties(channel) AS toProperties, properties(edge) AS relationshipProperties
`;

// Match the installed GraphQL library's subscription serialization: scalar
// Neo4j integers become numbers (or strings outside the safe range). Other
// property values, including temporal/spatial values and arrays, pass through.
const serializeValue = (value: unknown): unknown =>
  neo4j.isInt(value) ? (value.inSafeRange() ? value.toNumber() : value.toString()) : value;
const serializeProperties = (properties: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, serializeValue(value)]));

export function createChannelCreatorModeratorRepository(
  driver: Driver,
  database = resolveNeo4jDatabase()
): ChannelCreatorModeratorRepository {
  return {
    async connect(channelUniqueName, displayName) {
      const session = driver.session({
        database,
        defaultAccessMode: neo4j.session.WRITE,
        bookmarkManager: driver.executeQueryBookmarkManager,
      });
      try {
        return await session.executeWrite(async (tx) => {
          const result = await tx.run(CONNECT_CREATOR_MODERATOR_QUERY, { channelUniqueName, displayName });
          // Inspect this query's counters, not counters from reconciliation or
          // other writes in the transaction. Missing/existing pairs emit nothing.
          if (!result.summary.counters.updates().relationshipsCreated) return null;
          const record = result.records[0];
          return {
            event: "create_relationship" as const,
            relationshipName: "MODERATOR_OF_CHANNEL",
            fromTypename: "ModerationProfile",
            toTypename: "Channel",
            id: record.get("id").toString(),
            id_from: record.get("id_from").toString(),
            id_to: record.get("id_to").toString(),
            timestamp: serializeValue(record.get("timestamp")) as number,
            properties: {
              from: serializeProperties(record.get("fromProperties")),
              to: serializeProperties(record.get("toProperties")),
              relationship: serializeProperties(record.get("relationshipProperties")),
            },
          };
        });
      } finally {
        await session.close();
      }
    },
  };
}
