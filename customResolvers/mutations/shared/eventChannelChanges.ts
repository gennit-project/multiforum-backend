import type { ManagedTransaction } from "neo4j-driver";
import {
  updateEventChannelQuery,
  severConnectionBetweenEventAndChannelQuery,
} from "../../cypher/cypherQueries.js";

export const applyEventChannelChanges = async ({
  transaction,
  eventId,
  channelConnections,
  channelDisconnections,
}: {
  transaction: ManagedTransaction;
  eventId: string | null | undefined;
  channelConnections: string[];
  channelDisconnections: string[];
}): Promise<void> => {
  for (const channelUniqueName of channelConnections) {
    await transaction.run(updateEventChannelQuery, {
      eventId,
      channelUniqueName,
    });
  }

  for (const channelUniqueName of channelDisconnections) {
    await transaction.run(severConnectionBetweenEventAndChannelQuery, {
      eventId,
      channelUniqueName,
    });
  }
};
