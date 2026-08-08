// Unit tests for the upvote graphql-shield rules. A shield rule exposes its raw
// resolver as `.func(parent, args, ctx, info)`, which runs the actual logic and
// throws on failure (shield's `.resolve` wrapper caches/swallows, so we call
// `.func` directly). We drive the argument-validation, not-found, and no-channel
// guard branches, plus the permission-check path with a fuller context (which
// denies for a user with no channel permission). In-memory OGM + driver; no DB.
import assert from "node:assert/strict";
import test from "node:test";
import { canUpvoteComment, canSuperUpvote, canUpvoteDiscussion } from "./votingRules.js";

const run = (r: any, args: any, ctx: any) => (r as any).func({}, args, ctx, {} as any);

// A ctx whose models return the supplied rows. A pre-set user short-circuits the
// identity lookup inside the permission check; ServerConfig/Channel rows let the
// permission check run to a (deny) decision rather than crashing.
function makeCtx(rows: Record<string, unknown[]> = {}) {
  return {
    user: { username: "alice", email: "alice@x.test", data: { username: "alice" } },
    req: { headers: {} },
    driver: { session: () => ({ run: async () => ({ records: [] }), close: async () => {} }) },
    ogm: { model: (name: string) => ({ find: async () => rows[name] ?? [] }) },
  } as any;
}

const withChannelCtx = (extra: Record<string, unknown[]>) =>
  makeCtx({ ServerConfig: [{ Admins: [], SuperAdmins: [] }], Channel: [{ uniqueName: "cats", Admins: [], Moderators: [] }], ...extra });

// A permission-check denial may throw noChannelPermission or return an Error;
// accept either as "denied and the tail ran".
async function expectDeniedOrError(promise: Promise<unknown>) {
  try {
    const r = await promise;
    assert.ok(r instanceof Error || r === false, `expected denial, got ${String(r)}`);
  } catch (e) {
    assert.ok(e instanceof Error);
  }
}

// ---- canUpvoteComment ----

test("canUpvoteComment throws when required args are missing", async () => {
  await assert.rejects(run(canUpvoteComment, { commentId: "", username: "" }, makeCtx()), /required/);
});

test("canUpvoteComment throws when the comment is not found", async () => {
  await assert.rejects(run(canUpvoteComment, { commentId: "c-1", username: "alice" }, makeCtx({ Comment: [] })), /No comment/);
});

test("canUpvoteComment throws when the comment has no channel", async () => {
  const ctx = makeCtx({ Comment: [{ id: "c-1", DiscussionChannel: null, Channel: null }] });
  await assert.rejects(run(canUpvoteComment, { commentId: "c-1", username: "alice" }, ctx), /No channel/);
});

test("canUpvoteComment falls back to the direct Channel relationship", async () => {
  const ctx = withChannelCtx({ Comment: [{ id: "c-1", DiscussionChannel: null, Channel: { uniqueName: "cats" } }] });
  await expectDeniedOrError(run(canUpvoteComment, { commentId: "c-1", username: "alice" }, ctx));
});

test("canUpvoteComment runs the permission check and denies without channel permission", async () => {
  const ctx = withChannelCtx({ Comment: [{ id: "c-1", DiscussionChannel: { channelUniqueName: "cats" } }] });
  await expectDeniedOrError(run(canUpvoteComment, { commentId: "c-1", username: "alice" }, ctx));
});

// ---- canSuperUpvote ----

test("canSuperUpvote throws when sourceType/sourceId are missing", async () => {
  await assert.rejects(run(canSuperUpvote, { sourceType: "", sourceId: "" }, makeCtx()), /required/);
});

test("canSuperUpvote throws on an unknown sourceType", async () => {
  await assert.rejects(run(canSuperUpvote, { sourceType: "banana", sourceId: "x" }, makeCtx()), /must be/);
});

test("canSuperUpvote resolves a comment source channel and denies without permission", async () => {
  const ctx = withChannelCtx({ Comment: [{ id: "c-1", DiscussionChannel: { channelUniqueName: "cats" } }] });
  await expectDeniedOrError(run(canSuperUpvote, { sourceType: "comment", sourceId: "c-1" }, ctx));
});

test("canSuperUpvote resolves a discussion source channel", async () => {
  const ctx = withChannelCtx({ DiscussionChannel: [{ id: "dc-1", channelUniqueName: "cats" }] });
  await expectDeniedOrError(run(canSuperUpvote, { sourceType: "discussion", sourceId: "dc-1" }, ctx));
});

test("canSuperUpvote uses a provided channel name directly", async () => {
  const ctx = withChannelCtx({});
  await expectDeniedOrError(
    run(canSuperUpvote, { sourceType: "comment", sourceId: "c-1", sourceChannelUniqueName: "cats" }, ctx)
  );
});

// ---- canUpvoteDiscussion ----

test("canUpvoteDiscussion throws when required args are missing", async () => {
  await assert.rejects(run(canUpvoteDiscussion, { discussionChannelId: "", username: "" }, makeCtx()), /required/);
});

test("canUpvoteDiscussion throws when the discussion channel is not found", async () => {
  await assert.rejects(
    run(canUpvoteDiscussion, { discussionChannelId: "dc-1", username: "alice" }, makeCtx({ DiscussionChannel: [] })),
    /No discussion channel/
  );
});

test("canUpvoteDiscussion runs the permission check and denies without permission", async () => {
  const ctx = withChannelCtx({ DiscussionChannel: [{ id: "dc-1", channelUniqueName: "cats" }] });
  await expectDeniedOrError(run(canUpvoteDiscussion, { discussionChannelId: "dc-1", username: "alice" }, ctx));
});
