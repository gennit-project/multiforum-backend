// Unit tests for the comment version-history middleware. Same approach as the
// discussion middleware: drive its branching (pass-through vs. snapshot fetch on
// a text change) with a stubbed resolver and a finite revision repository; the
// delegated hook writes run against the stub. No DB.
import assert from "node:assert/strict";
import test from "node:test";
import middleware from "./commentVersionHistoryMiddleware.js";

const M: any = (middleware as any).Mutation;
const RESULT = { comments: [{ id: "c-1" }] };

function makeCtx(models: Record<string, any> = {}) {
  const calls: string[] = [];
  const find = async (name: string) => { calls.push(name); return models[name]?.find?.() ?? []; };
  const commentRevisionRepository = {
    findSnapshot: () => find("Comment"),
    findEditor: () => find("User"),
    createPreviousText: async () => ({textVersions: []}),
    findCommentIds: () => find("Comment"),
    connectPreviousText: async () => {},
  };
  return { ctx: { commentRevisionRepository, issueActivityRepository: {findRelatedIssueIds: async () => []}, driver: {}, user: { username: "alice" } } as any, calls };
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
  id: "c-1",
  text: "old text",
  CommentAuthor: { username: "alice" },
  DiscussionChannel: { discussionId: "d-1", channelUniqueName: "cats", Discussion: { id: "d-1", title: "T" } },
  Event: null,
  PastVersions: [],
};

test("passes through to the resolver when there is no update", async () => {
  const { ctx, calls } = makeCtx();
  const { resolve, state } = countingResolve();
  const out = await M.updateComments(resolve, null, { where: { id: "c-1" } }, ctx, {});
  assert.equal(out, RESULT);
  assert.equal(state.calls, 1);
  assert.deepEqual(calls, []);
});

test("does nothing extra when the text is not being updated", async () => {
  const { ctx, calls } = makeCtx();
  const { resolve, state } = countingResolve();
  const out = await M.updateComments(resolve, null, { where: { id: "c-1" }, update: { pinned: true } }, ctx, {});
  assert.equal(out, RESULT);
  assert.equal(state.calls, 1);
  assert.deepEqual(calls, []);
});

test("fetches a snapshot and runs the version path on a text change", async () => {
  const { ctx, calls } = makeCtx({ Comment: { find: async () => [snapshot] } });
  const { resolve, state } = countingResolve();
  const out = await M.updateComments(
    resolve,
    null,
    { where: { id: "c-1" }, update: { text: "new text" } },
    ctx,
    {}
  );
  assert.equal(out, RESULT);
  assert.equal(state.calls, 1);
  assert.ok(calls.includes("Comment"), "fetched the pre-update snapshot");
});

test("still runs after the resolver even when the snapshot is missing (no id)", async () => {
  const { ctx } = makeCtx();
  const { resolve, state } = countingResolve();
  const out = await M.updateComments(resolve, null, { where: {}, update: { text: "new text" } }, ctx, {});
  assert.equal(out, RESULT);
  assert.equal(state.calls, 1);
});
