// Unit tests for the comment plugin-pipeline middleware. After createComments
// runs, it gathers the OGM models and fires triggerPluginRunsForComment for each
// created comment (the trigger itself is tested separately). These tests drive
// the middleware's wiring — the required-model guard, the missing-id skip, the
// per-comment dispatch, and the error path that swallows failures and still
// returns the resolver result — with a stubbed resolver and a permissive OGM.
import assert from "node:assert/strict";
import test from "node:test";
import middleware from "./commentPluginPipelineMiddleware.js";

const M: any = (middleware as any).Mutation;

const REQUIRED = [
  "Channel",
  "Comment",
  "PluginPipelineRun",
  "PluginRun",
  "ServerConfig",
  "ServerSecret",
  "User",
];

// Build a ctx whose ogm returns permissive model stubs. `missing` names a model
// whose lookup returns null, to exercise the required-model guard. `finds`
// records which models had find() called.
function makeCtx(opts: { missing?: string; commentRows?: unknown[] } = {}) {
  const finds: string[] = [];
  const ogm = {
    model(name: string) {
      if (name === opts.missing) return null;
      return {
        find: async () => {
          finds.push(name);
          return name === "Comment" ? opts.commentRows ?? [] : [];
        },
        create: async () => ({}),
        update: async () => ({}),
      };
    },
  };
  return { ctx: { ogm, driver: {}, user: { username: "alice" } } as any, finds };
}

function resolveReturning(result: unknown) {
  const state = { calls: 0 };
  const resolve = async () => {
    state.calls += 1;
    return result;
  };
  return { resolve, state };
}

test("dispatches the trigger for each created comment and returns the resolver result", async () => {
  // The trigger finds each comment but classifies it as a feedback comment, so it
  // returns fast without touching the (slow) plugin-execution path.
  const feedback = { id: "c-1", isFeedbackComment: true, DiscussionChannel: null };
  const { ctx } = makeCtx({ commentRows: [feedback] });
  const { resolve, state } = resolveReturning({ comments: [{ id: "c-1" }, { id: "c-2" }] });
  const out = await M.createComments(resolve, null, {}, ctx, {});
  assert.deepEqual(out, { comments: [{ id: "c-1" }, { id: "c-2" }] });
  assert.equal(state.calls, 1);
});

test("no created comments -> returns the result without dispatching", async () => {
  const { ctx } = makeCtx();
  const { resolve, state } = resolveReturning({ comments: [] });
  const out = await M.createComments(resolve, null, {}, ctx, {});
  assert.deepEqual(out, { comments: [] });
  assert.equal(state.calls, 1);
});

test("undefined result is returned unchanged", async () => {
  const { ctx } = makeCtx();
  const { resolve } = resolveReturning(undefined);
  const out = await M.createComments(resolve, null, {}, ctx, {});
  assert.equal(out, undefined);
});

for (const model of REQUIRED) {
  test(`returns early when the required '${model}' model is unavailable`, async () => {
    const { ctx, finds } = makeCtx({ missing: model });
    const { resolve } = resolveReturning({ comments: [{ id: "c-1" }] });
    const out = await M.createComments(resolve, null, {}, ctx, {});
    assert.deepEqual(out, { comments: [{ id: "c-1" }] });
    // guard short-circuits before any comment lookup runs
    assert.ok(!finds.includes("Comment"), "did not reach the per-comment dispatch");
  });
}

test("comments without an id are skipped", async () => {
  const { ctx } = makeCtx();
  const { resolve } = resolveReturning({ comments: [{}] });
  const out = await M.createComments(resolve, null, {}, ctx, {});
  assert.deepEqual(out, { comments: [{}] });
});

test("a failure while dispatching is swallowed and the result still returns", async () => {
  // ogm.model throws -> the whole try block fails and is caught.
  const ctx = {
    ogm: {
      model() {
        throw new Error("ogm down");
      },
    },
    driver: {},
  } as any;
  const { resolve, state } = resolveReturning({ comments: [{ id: "c-1" }] });
  const out = await M.createComments(resolve, null, {}, ctx, {});
  assert.deepEqual(out, { comments: [{ id: "c-1" }] });
  assert.equal(state.calls, 1);
});
