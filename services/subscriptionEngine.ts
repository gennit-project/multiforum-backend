import { EventEmitter } from "node:events";
import type { Neo4jGraphQLSubscriptionsEngine } from "@neo4j/graphql";

/** The same in-process transport used by generated mutations and driver writes. */
export function createSubscriptionEngine(): Neo4jGraphQLSubscriptionsEngine {
  const events = new EventEmitter();
  let closed = false;
  return {
    events,
    publish(event) {
      if (!closed) events.emit(event.event, event);
    },
    close() {
      closed = true;
    },
  };
}
