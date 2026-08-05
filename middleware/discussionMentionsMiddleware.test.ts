// Unit tests for the discussion user-mention middleware. It wraps the discussion
// create resolvers, and after the create, looks up each new discussion and hands
// it to the user-mention notification hook (tested separately). These tests drive
// its branching — result shapes (array vs { discussions }), the no-id / not-found
// skips, and the error path that must swallow failures and still return the
// resolver result — with a stubbed resolver and a permissive in-memory OGM. No DB.
import assert from "node:assert/strict";
import test from "node:test";
import middleware from "./discussionMentionsMiddleware.js";

const M: any = (middleware as any).Mutation;

// A permissive OGM: every model resolves to safe no-ops, with per-model overrides.
// `calls` records which models were looked up so we can assert whether the
// middleware fetched the discussion snapshot.
function makeCtx(models: Record<string, any> = {}) {
  const calls: string[] = [];
  const finds: string[] = []; // models whose find() actually ran
  const ogm = {
    model(name: string) {
      calls.push(name);
      const o = models[name] || {};
      return {
        find: async (...args: unknown[]) => {
          finds.push(name);
          return o.find ? o.find(...args) : [];
        },
        create: o.create ?? (async () => ({})),
        update: o.update ?? (async () => ({})),
        delete: o.delete ?? (async () => ({})),
      };
    },
  };
  return { ctx: { ogm, driver: {}, user: { username: "alice" } } as any, calls, finds };
}

function resolveReturning(result: unknown) {
  const state = { calls: 0 };
  const resolve = async () => {
    state.calls += 1;
    return result;
  };
  return { resolve, state };
}

const snapshot = {
  id: "d-1",
  title: "Hello @bob",
  body: "Ping @carol in the body",
  Author: { username: "alice", displayName: "Alice" },
  DiscussionChannels: [{ channelUniqueName: "cats" }],
};

test("createDiscussions: looks up the new discussion and returns the resolver result", async () => {
  const { ctx, calls } = makeCtx({ Discussion: { find: async () => [snapshot] } });
  const { resolve, state } = resolveReturning({ discussions: [{ id: "d-1" }] });
  const out = await M.createDiscussions(resolve, null, {}, ctx, {});
  assert.deepEqual(out, { discussions: [{ id: "d-1" }] });
  assert.equal(state.calls, 1);
  assert.ok(calls.includes("Discussion"), "fetched the created discussion snapshot");
});

test("createDiscussions: no created discussions -> no snapshot lookup", async () => {
  const { ctx, finds } = makeCtx();
  const { resolve, state } = resolveReturning({ discussions: [] });
  const out = await M.createDiscussions(resolve, null, {}, ctx, {});
  assert.deepEqual(out, { discussions: [] });
  assert.equal(state.calls, 1);
  assert.deepEqual(finds, []); // early return before any find()
});

test("createDiscussions: entries without an id are skipped", async () => {
  const { ctx } = makeCtx({ Discussion: { find: async () => [snapshot] } });
  const { resolve } = resolveReturning({ discussions: [{}] }); // no id
  const out = await M.createDiscussions(resolve, null, {}, ctx, {});
  assert.deepEqual(out, { discussions: [{}] }); // returned unchanged, no throw
});

test("createDiscussions: a not-found snapshot is skipped without throwing", async () => {
  const { ctx, calls } = makeCtx({ Discussion: { find: async () => [] } });
  const { resolve } = resolveReturning({ discussions: [{ id: "missing" }] });
  const out = await M.createDiscussions(resolve, null, {}, ctx, {});
  assert.deepEqual(out, { discussions: [{ id: "missing" }] });
  assert.ok(calls.includes("Discussion"));
});

test("createDiscussions: a failure in the mention lookup is swallowed and the result still returns", async () => {
  const { ctx } = makeCtx({
    Discussion: {
      find: async () => {
        throw new Error("boom");
      },
    },
  });
  const { resolve, state } = resolveReturning({ discussions: [{ id: "d-1" }] });
  const out = await M.createDiscussions(resolve, null, {}, ctx, {});
  assert.deepEqual(out, { discussions: [{ id: "d-1" }] }); // error swallowed
  assert.equal(state.calls, 1);
});

test("createDiscussionWithChannelConnections: handles an array-shaped result", async () => {
  const { ctx, calls } = makeCtx({ Discussion: { find: async () => [snapshot] } });
  const { resolve } = resolveReturning([{ id: "d-1" }]); // array shape
  const out = await M.createDiscussionWithChannelConnections(resolve, null, {}, ctx, {});
  assert.deepEqual(out, [{ id: "d-1" }]);
  assert.ok(calls.includes("Discussion"));
});

test("createDiscussionWithChannelConnections: handles a { discussions } result", async () => {
  const { ctx, calls } = makeCtx({ Discussion: { find: async () => [snapshot] } });
  const { resolve } = resolveReturning({ discussions: [{ id: "d-1" }] });
  const out = await M.createDiscussionWithChannelConnections(resolve, null, {}, ctx, {});
  assert.deepEqual(out, { discussions: [{ id: "d-1" }] });
  assert.ok(calls.includes("Discussion"));
});

test("createDiscussionWithChannelConnections: swallows a mention-lookup failure and still returns", async () => {
  const { ctx } = makeCtx({
    Discussion: {
      find: async () => {
        throw new Error("boom");
      },
    },
  });
  const { resolve, state } = resolveReturning([{ id: "d-1" }]);
  const out = await M.createDiscussionWithChannelConnections(resolve, null, {}, ctx, {});
  assert.deepEqual(out, [{ id: "d-1" }]); // error swallowed
  assert.equal(state.calls, 1);
});
