import assert from "node:assert/strict";
import test from "node:test";
import neo4j, { type Driver } from "neo4j-driver";
import { makeResult } from "../../tests/fixtures/neo4j.js";
import { createSubscriptionTargetRepository, SUBSCRIPTION_TARGET_QUERIES } from "./subscriptionTargetRepository.js";

const setup = (failure = false) => {
  const configs: unknown[] = [];
  const calls: unknown[] = [];
  let closed = 0;
  const bookmarks = neo4j.bookmarkManager();
  const driver = { executeQueryBookmarkManager: bookmarks, session(config: unknown) {
    configs.push(config);
    return { async executeRead(work: (tx: unknown) => Promise<unknown>) {
      return work({ async run(query: string, params: unknown) {
        calls.push([query, params]);
        if (failure) throw new Error("read failed");
        return makeResult([{ target: { id: "target", title: "title", description: null,
          createdAt: "2026-10-20T02:00:00+02:00", subscribers: [] } }]);
      } });
    }, async close() { closed++; } };
  } } as unknown as Driver;
  return { driver, configs, calls, bookmarks, closed: () => closed };
};
test("subscription snapshots retain managed READ, explicit database, bookmarks and temporal serialization", async () => {
  const state = setup();
  const repository = createSubscriptionTargetRepository(state.driver, "subscriptions");
  assert.deepEqual(await repository.findEvent("target"), [{ id: "target", title: "title", description: null,
    createdAt: "2026-10-20T00:00:00.000Z", SubscribedToNotifications: [] }]);
  assert.deepEqual(state.configs, [{ database: "subscriptions", defaultAccessMode: neo4j.session.READ, bookmarkManager: state.bookmarks }]);
  assert.deepEqual(state.calls, [[SUBSCRIPTION_TARGET_QUERIES.Event, { id: "target" }]]);
  assert.equal(state.closed(), 1);
});
test("read failures propagate unchanged and close their managed session", async () => {
  const state = setup(true);
  await assert.rejects(createSubscriptionTargetRepository(state.driver).findComment("target"), { message: "read failed" });
  assert.equal(state.closed(), 1);
});
