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
  channelConnections: string[] | null | undefined;
  channelDisconnections: (string | null)[] | null | undefined;
}): Promise<void> => {
  // Preserve the existing for-of TypeError at this transaction boundary.
  if (channelConnections == null) throw new TypeError("channelConnections is not iterable");
  for (const channelUniqueName of channelConnections) {
    await transaction.run(updateEventChannelQuery, {
      eventId,
      channelUniqueName,
    });
  }

  if (channelDisconnections == null) throw new TypeError("channelDisconnections is not iterable");
  for (const channelUniqueName of channelDisconnections) {
    await transaction.run(severConnectionBetweenEventAndChannelQuery, {
      eventId,
      channelUniqueName,
    });
  }
};
