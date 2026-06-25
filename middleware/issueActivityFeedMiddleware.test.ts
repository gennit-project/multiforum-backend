// Unit tests for the issue activity-feed middleware, which records "deleted"/
// "edited" activity on the related issue around delete/update mutations. Each
// wrapper is invoked with a stubbed resolver and a permissive in-memory OGM,
// asserting result pass-through and exercising the record / no-record branches.
// The delegated activity-feed writes run against the stub. No DB.
import assert from "node:assert/strict";
import test from "node:test";
import middleware from "./issueActivityFeedMiddleware.js";

const M: any = (middleware as any).Mutation;

function makeCtx() {
  const ogm = {
    model() {
      return {
        find: async () => [],
        create: async () => ({}),
        update: async () => ({}),
        delete: async () => ({}),
      };
    },
  };
  return { ogm, driver: {}, user: { username: "alice" } } as any;
}

// Resolver returning a fixed value, counting invocations.
function resolveWith(value: unknown) {
  const state = { calls: 0 };
  const resolve = async () => {
    state.calls += 1;
    return value;
  };
  return { resolve, state };
}

test("deleteComments records activity when a comment is deleted", async () => {
  const { resolve, state } = resolveWith({ nodesDeleted: 1 });
  const out = await M.deleteComments(resolve, null, { where: { id: "c-1" } }, makeCtx(), {});
  assert.deepEqual(out, { nodesDeleted: 1 });
  assert.equal(state.calls, 1);
});

test("deleteComments does not record when nothing was deleted", async () => {
  const { resolve, state } = resolveWith({ nodesDeleted: 0 });
  const out = await M.deleteComments(resolve, null, { where: { id: "c-1" } }, makeCtx(), {});
  assert.deepEqual(out, { nodesDeleted: 0 });
  assert.equal(state.calls, 1);
});

test("deleteComments passes through when no id is supplied", async () => {
  const { resolve, state } = resolveWith({ nodesDeleted: 1 });
  const out = await M.deleteComments(resolve, null, { where: {} }, makeCtx(), {});
  assert.deepEqual(out, { nodesDeleted: 1 });
  assert.equal(state.calls, 1);
});

test("deleteDiscussions records activity when a discussion is deleted", async () => {
  const { resolve, state } = resolveWith({ nodesDeleted: 1 });
  const out = await M.deleteDiscussions(resolve, null, { where: { id: "d-1" } }, makeCtx(), {});
  assert.deepEqual(out, { nodesDeleted: 1 });
  assert.equal(state.calls, 1);
});

test("deleteEvents records activity when an event is deleted", async () => {
  const { resolve, state } = resolveWith({ nodesDeleted: 1 });
  const out = await M.deleteEvents(resolve, null, { where: { id: "e-1" } }, makeCtx(), {});
  assert.deepEqual(out, { nodesDeleted: 1 });
  assert.equal(state.calls, 1);
});

test("updateEvents records an edit when there are updates", async () => {
  const { resolve, state } = resolveWith({ events: [{ id: "e-1" }] });
  const out = await M.updateEvents(resolve, null, { where: { id: "e-1" }, update: { title: "new" } }, makeCtx(), {});
  assert.deepEqual(out, { events: [{ id: "e-1" }] });
  assert.equal(state.calls, 1);
});

test("updateEvents does not record when the update is empty", async () => {
  const { resolve, state } = resolveWith({ events: [] });
  await M.updateEvents(resolve, null, { where: { id: "e-1" }, update: {} }, makeCtx(), {});
  assert.equal(state.calls, 1);
});

test("updateEvents passes through when no id is supplied", async () => {
  const { resolve, state } = resolveWith({ events: [] });
  await M.updateEvents(resolve, null, { where: {}, update: { title: "new" } }, makeCtx(), {});
  assert.equal(state.calls, 1);
});

test("updateEventWithChannelConnections records an edit when an id is present", async () => {
  const { resolve, state } = resolveWith({ id: "e-1" });
  await M.updateEventWithChannelConnections(resolve, null, { where: { id: "e-1" } }, makeCtx(), {});
  assert.equal(state.calls, 1);
});

test("updateEventWithChannelConnections passes through with no id", async () => {
  const { resolve, state } = resolveWith({ id: null });
  await M.updateEventWithChannelConnections(resolve, null, { where: {} }, makeCtx(), {});
  assert.equal(state.calls, 1);
});
