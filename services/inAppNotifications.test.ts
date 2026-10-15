import test from "node:test";
import assert from "node:assert/strict";
import neo4j, { type Driver } from "neo4j-driver";
import { createInAppNotificationsForUsers } from "./inAppNotifications.js";

test("createInAppNotificationsForUsers writes one batch and closes its session", async () => {
  const runCalls: Array<{ query: string; params: Record<string, unknown> }> = [];
  let closeCalls = 0;
  const driver = {
    session() {
      return {
        async run(query: string, params: Record<string, unknown>) {
          runCalls.push({ query, params });
          return {
            records: [{ get: () => neo4j.int(2) }],
          };
        },
        async close() {
          closeCalls += 1;
        },
      };
    },
  } as unknown as Driver;

  const count = await createInAppNotificationsForUsers({
    driver,
    usernames: ["alice", "bob"],
    notificationText: "An event changed.",
    notificationType: "event",
  });

  assert.equal(count, 2);
  assert.equal(runCalls.length, 1);
  assert.deepEqual(runCalls[0]?.params, {
    usernames: ["alice", "bob"],
    notificationText: "An event changed.",
    notificationType: "event",
  });
  assert.equal(closeCalls, 1);
});

test("createInAppNotificationsForUsers skips empty recipient lists", async () => {
  let sessionCalls = 0;
  const driver = {
    session() {
      sessionCalls += 1;
      throw new Error("should not open a session");
    },
  } as unknown as Driver;

  const count = await createInAppNotificationsForUsers({
    driver,
    usernames: [],
    notificationText: "Unused",
    notificationType: "event",
  });

  assert.equal(count, 0);
  assert.equal(sessionCalls, 0);
});
