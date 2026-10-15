import test from "node:test";
import assert from "node:assert/strict";
import type { ManagedTransaction } from "neo4j-driver";
import {
  updateEventChannelQuery,
  severConnectionBetweenEventAndChannelQuery,
} from "../../cypher/cypherQueries.js";
import { applyEventChannelChanges } from "./eventChannelChanges.js";

test("applyEventChannelChanges applies connections before disconnections", async () => {
  const calls: Array<{ query: string; params: Record<string, unknown> }> = [];
  const transaction = {
    async run(query: string, params: Record<string, unknown>) {
      calls.push({ query, params });
      return {};
    },
  } as unknown as ManagedTransaction;

  await applyEventChannelChanges({
    transaction,
    eventId: "event-1",
    channelConnections: ["general", "events"],
    channelDisconnections: ["archive"],
  });

  assert.deepEqual(calls, [
    {
      query: updateEventChannelQuery,
      params: { eventId: "event-1", channelUniqueName: "general" },
    },
    {
      query: updateEventChannelQuery,
      params: { eventId: "event-1", channelUniqueName: "events" },
    },
    {
      query: severConnectionBetweenEventAndChannelQuery,
      params: { eventId: "event-1", channelUniqueName: "archive" },
    },
  ]);
});
