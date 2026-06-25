// Unit tests for the discussion version-history middleware. The middleware wraps
// the update resolvers, captures a pre-update snapshot, and delegates the actual
// version/notification writes to hooks (tested separately). These tests drive
// its own branching — when it short-circuits to the resolver vs. when it fetches
// a snapshot — with a stubbed resolver and a permissive in-memory OGM. No DB.
import assert from "node:assert/strict";
import test from "node:test";
import middleware from "./discussionVersionHistoryMiddleware.js";

const M: any = (middleware as any).Mutation;
const RESULT = { discussions: [{ id: "d-1" }] };

// A permissive OGM: any model resolves to safe no-ops, with overrides per model.
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
  id: "d-1",
  title: "old title",
  body: "old body",
  Author: { username: "alice", displayName: "Alice" },
  BodyLastEditedBy: { username: "alice" },
  DiscussionChannels: [{ channelUniqueName: "cats" }],
  PastTitleVersions: [],
  PastBodyVersions: [],
};

test("updateDiscussions: passes through to the resolver when there is no update", async () => {
  const { ctx, calls } = makeCtx();
  const { resolve, state } = countingResolve();
  const out = await M.updateDiscussions(resolve, null, { where: { id: "d-1" } }, ctx, {});
  assert.equal(out, RESULT);
  assert.equal(state.calls, 1);
  assert.deepEqual(calls, []); // no snapshot fetch
});

test("updateDiscussions: does not fetch a snapshot when neither title nor body changes", async () => {
  const { ctx, calls } = makeCtx();
  const { resolve, state } = countingResolve();
  const out = await M.updateDiscussions(resolve, null, { where: { id: "d-1" }, update: { pinned: true } }, ctx, {});
  assert.equal(out, RESULT);
  assert.equal(state.calls, 1);
  assert.deepEqual(calls, []);
});

test("updateDiscussions: skips snapshot/hooks when no discussion id is given", async () => {
  const { ctx, calls } = makeCtx();
  const { resolve, state } = countingResolve();
  const out = await M.updateDiscussions(resolve, null, { where: {}, update: { title: "new" } }, ctx, {});
  assert.equal(out, RESULT);
  assert.equal(state.calls, 1);
  assert.deepEqual(calls, []);
});

test("updateDiscussions: fetches a snapshot and runs the update path on a title/body change", async () => {
  const { ctx, calls } = makeCtx({ Discussion: { find: async () => [snapshot] } });
  const { resolve, state } = countingResolve();
  const out = await M.updateDiscussions(
    resolve,
    null,
    { where: { id: "d-1" }, update: { title: "new title", body: "new body" } },
    ctx,
    {}
  );
  assert.equal(out, RESULT);
  assert.equal(state.calls, 1);
  assert.ok(calls.includes("Discussion"), "fetched the pre-update snapshot");
});

test("updateDiscussionWithChannelConnections: passes through when there is no update input", async () => {
  const { ctx, calls } = makeCtx();
  const { resolve, state } = countingResolve();
  const out = await M.updateDiscussionWithChannelConnections(resolve, null, { where: { id: "d-1" } }, ctx, {});
  assert.equal(out, RESULT);
  assert.equal(state.calls, 1);
  assert.deepEqual(calls, []);
});

test("updateDiscussionWithChannelConnections: fetches a snapshot on a body change", async () => {
  const { ctx, calls } = makeCtx({ Discussion: { find: async () => [snapshot] } });
  const { resolve, state } = countingResolve();
  const out = await M.updateDiscussionWithChannelConnections(
    resolve,
    null,
    { where: { id: "d-1" }, discussionUpdateInput: { body: "new body" } },
    ctx,
    {}
  );
  assert.equal(out, RESULT);
  assert.equal(state.calls, 1);
  assert.ok(calls.includes("Discussion"));
});
