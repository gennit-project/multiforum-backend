// Unit tests for the comment user-mention middleware. After createComments runs,
// it looks up each created comment and hands it to the user-mention notification
// hook (tested separately). These tests drive its branching — no comments, no
// model, missing id, not-found snapshot, the happy path, and the error path that
// must swallow failures and still return the resolver result — with a stubbed
// resolver and a permissive in-memory OGM. No DB.
import assert from "node:assert/strict";
import test from "node:test";
import middleware from "./commentUserMentionsMiddleware.js";

const M: any = (middleware as any).Mutation;

function makeCtx(models: Record<string, any> = {}) {
  const calls: string[] = [];
  const finds: string[] = [];
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
  id: "c-1",
  text: "hey @bob take a look",
  CommentAuthor: { username: "alice", displayName: "Alice" },
  DiscussionChannel: {
    discussionId: "d-1",
    channelUniqueName: "cats",
    Discussion: { id: "d-1", title: "T" },
  },
  Event: null,
};

test("createComments: looks up the new comment and returns the resolver result", async () => {
  const { ctx, finds } = makeCtx({ Comment: { find: async () => [snapshot] } });
  const { resolve, state } = resolveReturning({ comments: [{ id: "c-1" }] });
  const out = await M.createComments(resolve, null, {}, ctx, {});
  assert.deepEqual(out, { comments: [{ id: "c-1" }] });
  assert.equal(state.calls, 1);
  assert.ok(finds.includes("Comment"), "fetched the created comment snapshot");
});

test("createComments: no created comments -> no snapshot lookup", async () => {
  const { ctx, finds } = makeCtx();
  const { resolve } = resolveReturning({ comments: [] });
  const out = await M.createComments(resolve, null, {}, ctx, {});
  assert.deepEqual(out, { comments: [] });
  assert.deepEqual(finds, []);
});

test("createComments: undefined result -> returns undefined without throwing", async () => {
  const { ctx, finds } = makeCtx();
  const { resolve } = resolveReturning(undefined);
  const out = await M.createComments(resolve, null, {}, ctx, {});
  assert.equal(out, undefined);
  assert.deepEqual(finds, []);
});

test("createComments: entries without an id are skipped", async () => {
  const { ctx } = makeCtx({ Comment: { find: async () => [snapshot] } });
  const { resolve } = resolveReturning({ comments: [{}] });
  const out = await M.createComments(resolve, null, {}, ctx, {});
  assert.deepEqual(out, { comments: [{}] });
});

test("createComments: a not-found snapshot is skipped without throwing", async () => {
  const { ctx, finds } = makeCtx({ Comment: { find: async () => [] } });
  const { resolve } = resolveReturning({ comments: [{ id: "missing" }] });
  const out = await M.createComments(resolve, null, {}, ctx, {});
  assert.deepEqual(out, { comments: [{ id: "missing" }] });
  assert.ok(finds.includes("Comment"));
});

test("createComments: a failure in the mention lookup is swallowed and the result still returns", async () => {
  const { ctx } = makeCtx({
    Comment: {
      find: async () => {
        throw new Error("boom");
      },
    },
  });
  const { resolve, state } = resolveReturning({ comments: [{ id: "c-1" }] });
  const out = await M.createComments(resolve, null, {}, ctx, {});
  assert.deepEqual(out, { comments: [{ id: "c-1" }] });
  assert.equal(state.calls, 1);
});
