import { EventEmitter } from "node:events";

/** A node-level change event (create/update/delete of a single node). */
export type NodeSubscriptionEvent = {
  event: "create" | "update" | "delete";
  typename: string;
  id: string;
  timestamp: number;
  properties: { old?: Record<string, unknown>; new?: Record<string, unknown> };
};

/** A relationship change event. */
export type RelationshipSubscriptionEvent = {
  event: "create_relationship" | "delete_relationship";
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

/** Payload the in-process transport relays; every event carries the event-kind
 *  string used as the emitter channel. v7 no longer exports these shapes. */
export type SubscriptionEnginePayload =
  | NodeSubscriptionEvent
  | RelationshipSubscriptionEvent;

/** In-process subscriptions transport used by generated mutations and driver
 *  writes. v7 dropped `publish` from the package's `Neo4jGraphQLSubscriptionsEngine`
 *  interface (and no longer re-exports it), so the custom engine is typed here.
 *  The returned object stays structurally compatible with the v7
 *  `features.subscriptions` option (events + close). */
export interface SubscriptionEngine {
  events: EventEmitter;
  publish(event: SubscriptionEnginePayload): void | Promise<void>;
  close(): void;
}

/** The same in-process transport used by generated mutations and driver writes. */
export function createSubscriptionEngine(): SubscriptionEngine {
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
