import type { EventUpdateInput } from "../../../src/generated/graphql.js";
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
  // Omitted/null lists leave links unchanged. Empty lists retain their existing
  // no-op meaning; only explicit names connect or disconnect relationships.
  for (const channelUniqueName of channelConnections ?? []) {
    await transaction.run(updateEventChannelQuery, {
      eventId,
      channelUniqueName,
    });
  }

  for (const channelUniqueName of channelDisconnections ?? []) {
    await transaction.run(severConnectionBetweenEventAndChannelQuery, {
      eventId,
      channelUniqueName,
    });
  }
};


/** v7 exposes a nullable relationship input but its update translator rejects
 * explicit null. In these custom mutations null means no channel operation.
 * Preserve every non-null operation and all unrelated fields unchanged.
 */
export function normalizeEventChannelUpdate(input: EventUpdateInput): EventUpdateInput {
  if (input.EventChannels !== null) return input;
  const { EventChannels: _unchanged, ...rest } = input;
  return rest;
}
