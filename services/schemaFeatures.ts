import type { SubscriptionEngine } from "./subscriptionEngine.js";

/** Keep the runtime and database-free schema export on the same API surface. */
export const createSchemaFeatures = (subscriptionEngine: SubscriptionEngine) => ({
  filters: { String: { MATCHES: true } },
  // The application uses its in-process subscription engine, not CDC. v7
  // accepts it at runtime but types this option as boolean | CDC engine.
  subscriptions: subscriptionEngine as unknown as boolean,
});
