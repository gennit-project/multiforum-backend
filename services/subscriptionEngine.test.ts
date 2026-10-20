import assert from "node:assert/strict";
import test from "node:test";
import { createSubscriptionEngine } from "./subscriptionEngine.js";

test("shared engine delivers the original event and stops publishing after close", () => {
  const engine = createSubscriptionEngine();
  const event = { event: "create" as const, typename: "Channel", properties: { old: undefined, new: { uniqueName: "C" } }, id: "1", timestamp: 1 };
  const received: unknown[] = [];
  engine.events.on("create", (value) => received.push(value));
  engine.publish(event);
  engine.close();
  engine.publish(event);
  assert.deepEqual(received, [event]);
});
