import assert from "node:assert/strict";
import test from "node:test";
import neo4j, { type Driver } from "neo4j-driver";
import { createChannelCreatorModeratorRepository, CONNECT_CREATOR_MODERATOR_QUERY } from "./channelCreatorModeratorRepository.js";
import { createChannelCreatorModeratorService } from "../channelCreatorModerator.js";

const eventRow: Record<string, unknown> = {
  id: neo4j.int(1), id_from: neo4j.int(2), id_to: neo4j.int(3), timestamp: neo4j.int(123),
  fromProperties: { displayName: "M", count: neo4j.int(7), large: neo4j.int("9223372036854775807") },
  toProperties: { uniqueName: "C" }, relationshipProperties: {},
};

function setup({ created = 1, fail = false, retry = false } = {}) {
  const configs: unknown[] = [];
  const calls: unknown[] = [];
  const order: string[] = [];
  const bookmarkManager = neo4j.bookmarkManager();
  const result = { records: [{ get: (key: string) => eventRow[key] }], summary: { counters: { updates: () => ({ relationshipsCreated: created }) } } };
  const driver = {
    executeQueryBookmarkManager: bookmarkManager,
    session(config: unknown) {
      configs.push(config);
      return {
        async executeWrite(work: (tx: unknown) => Promise<unknown>) {
          const tx = { run: async (query: string, parameters: unknown) => { calls.push({ query, parameters }); return result; } };
          if (retry) { await work(tx); order.push("rollback"); }
          const value = await work(tx);
          if (fail) { order.push("rollback"); throw new Error("commit failed"); }
          order.push("commit");
          return value;
        },
        async close() { order.push("close"); },
      };
    },
  } as unknown as Driver;
  return { driver, configs, calls, order, bookmarkManager };
}

test("assignment preserves explicit WRITE database/bookmarks and publishes only after the successful retry commits", async () => {
  const state = setup({ retry: true });
  const service = createChannelCreatorModeratorService(createChannelCreatorModeratorRepository(state.driver, "forums"), {
    publish(event) {
      state.order.push("publish");
      assert.equal(event.event, "create_relationship");
      if (event.event !== "create_relationship") return;
      assert.equal(event.id, "1");
      assert.equal(event.timestamp, 123);
      assert.deepEqual(event.properties.from, { displayName: "M", count: 7, large: "9223372036854775807" });
    },
  });
  await service.assign("C' quoted", "M");
  assert.deepEqual(state.order, ["rollback", "commit", "close", "publish"]);
  assert.deepEqual(state.configs, [{ database: "forums", defaultAccessMode: neo4j.session.WRITE, bookmarkManager: state.bookmarkManager }]);
  assert.deepEqual(state.calls, Array(2).fill({ query: CONNECT_CREATOR_MODERATOR_QUERY, parameters: { channelUniqueName: "C' quoted", displayName: "M" } }));
});

test("failed commit closes the session without publishing", async () => {
  const state = setup({ fail: true });
  const service = createChannelCreatorModeratorService(createChannelCreatorModeratorRepository(state.driver), { publish() { assert.fail("must not publish"); } });
  await assert.rejects(service.assign("C", "M"), /commit failed/);
  assert.deepEqual(state.order, ["rollback", "close"]);
});

test("a no-op write does not publish", async () => {
  const state = setup({ created: 0 });
  await createChannelCreatorModeratorService(createChannelCreatorModeratorRepository(state.driver), { publish() { assert.fail("must not publish"); } }).assign("C", "M");
});

test("sync and async publication failures do not fail assignment or repeat writes", async () => {
  for (const publish of [() => { throw new Error("sync"); }, () => Promise.reject(new Error("async"))]) {
    const state = setup();
    await createChannelCreatorModeratorService(createChannelCreatorModeratorRepository(state.driver), { publish }).assign("C", "M");
    assert.equal(state.calls.length, 1);
    assert.deepEqual(state.order, ["commit", "close"]);
  }
});
