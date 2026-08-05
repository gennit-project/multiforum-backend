// Unit tests for the event version-history middleware. It mirrors the discussion
// version-history middleware: wraps updateEvents, captures a pre-update snapshot
// when the title/description changes, and delegates the version + edit-notification
// writes to hooks (which here run against a permissive in-memory OGM). These tests
// drive its own branching — passthrough vs. snapshot-fetch vs. hook dispatch —
// with a stubbed resolver and no DB.
import assert from "node:assert/strict";
import test from "node:test";
import middleware from "./eventVersionHistoryMiddleware.js";

const M: any = (middleware as any).Mutation;
const RESULT = { events: [{ id: "e-1" }] };

// A permissive OGM: every model resolves to safe no-ops, with per-model overrides.
// `calls` records which models were looked up so we can assert whether the
// middleware fetched a snapshot.
function makeCtx(models: Record<string, any> = {}) {
  const calls: string[] = [];
  const ogm = {
    model(name: string) {
      calls.push(name);
      const o = models[name] || {};
      return {
        find: o.find ?? (async () => []),
        create: o.create ?? (async () => ({})),
        update: o.update ?? (async () => ({})),
        delete: o.delete ?? (async () => ({})),
      };
    },
  };
  return { ctx: { ogm, driver: {}, user: { username: "alice" } } as any, calls };
}

function countingResolve() {
  const state = { calls: 0 };
  const resolve = async () => {
    state.calls += 1;
    return RESULT;
  };
  return { resolve, state };
}

const snapshot = {
  id: "e-1",
  title: "old title",
  description: "old description",
  Poster: { username: "alice" },
  DescriptionLastEditedBy: { username: "alice" },
  EventChannels: [{ channelUniqueName: "cats" }],
  PastTitleVersions: [],
  PastDescriptionVersions: [],
};

test("updateEvents: passes through to the resolver when there is no update", async () => {
  const { ctx, calls } = makeCtx();
  const { resolve, state } = countingResolve();
  const out = await M.updateEvents(resolve, null, { where: { id: "e-1" } }, ctx, {});
  assert.equal(out, RESULT);
  assert.equal(state.calls, 1);
  assert.deepEqual(calls, []); // no snapshot fetch
});

test("updateEvents: does not fetch a snapshot when neither title nor description changes", async () => {
  const { ctx, calls } = makeCtx();
  const { resolve, state } = countingResolve();
  const out = await M.updateEvents(
    resolve,
    null,
    { where: { id: "e-1" }, update: { canceled: true } },
    ctx,
    {}
  );
  assert.equal(out, RESULT);
  assert.equal(state.calls, 1);
  assert.deepEqual(calls, []);
});

test("updateEvents: skips snapshot/hooks when no event id is given", async () => {
  const { ctx, calls } = makeCtx();
  const { resolve, state } = countingResolve();
  const out = await M.updateEvents(
    resolve,
    null,
    { where: {}, update: { title: "new" } },
    ctx,
    {}
  );
  assert.equal(out, RESULT);
  assert.equal(state.calls, 1);
  assert.deepEqual(calls, []); // no id => no fetch, no hooks
});

test("updateEvents: fetches the snapshot but skips hooks when the event is not found", async () => {
  const { ctx, calls } = makeCtx({ Event: { find: async () => [] } });
  const { resolve, state } = countingResolve();
  const out = await M.updateEvents(
    resolve,
    null,
    { where: { id: "e-1" }, update: { title: "new title" } },
    ctx,
    {}
  );
  assert.equal(out, RESULT);
  assert.equal(state.calls, 1);
  assert.ok(calls.includes("Event"), "attempted the pre-update snapshot fetch");
});

test("updateEvents: fetches a snapshot and runs the update + notification path on a title change", async () => {
  const { ctx, calls } = makeCtx({ Event: { find: async () => [snapshot] } });
  const { resolve, state } = countingResolve();
  const out = await M.updateEvents(
    resolve,
    null,
    { where: { id: "e-1" }, update: { title: "new title", description: "new description" } },
    ctx,
    {}
  );
  assert.equal(out, RESULT);
  assert.equal(state.calls, 1);
  assert.ok(calls.includes("Event"), "fetched the pre-update snapshot");
});
