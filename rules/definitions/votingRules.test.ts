// Unit tests for the upvote graphql-shield rules. A shield rule exposes its raw
// resolver as `.func(parent, args, ctx, info)`, which runs the actual logic and
// throws on failure (shield's `.resolve` wrapper caches/swallows, so we call
// `.func` directly). We drive the argument-validation, not-found, and no-channel
// guard branches, plus the permission-check path with a fuller context (which
// denies for a user with no channel permission). Repository seams only; no DB.
import assert from "node:assert/strict";
import test from "node:test";
import { canUpvoteComment, canSuperUpvote, canUpvoteDiscussion } from "./votingRules.js";

const run = (r: any, args: any, ctx: any) => (r as any).func({}, args, ctx, {} as any);

type LookupCounters = {
  commentCalls: number;
  discussionCalls: number;
  permissionChannels: string[];
};

const makeCounters = (): LookupCounters => ({
  commentCalls: 0,
  discussionCalls: 0,
  permissionChannels: [],
});

// A pre-set user short-circuits identity lookup. The repository seam maps the
// old OGM-shaped fixtures into the narrow records consumed by the rules, while
// ogm.model throws to prove voting authorization never falls back to the OGM.
function makeCtx(
  rows: Record<string, unknown[]> = {},
  counters = makeCounters()
) {
  return {
    user: { username: "alice", email: "alice@x.test", data: { username: "alice" } },
    req: { headers: {} },
    driver: {},
    permissionServerConfigRepository: {
      findByName: async () => rows.ServerConfig?.[0] ?? null,
    },
    contentChannelPermissionRepository: {
      async findCommentChannelReferences() {
        counters.commentCalls += 1;
        const comment = rows.Comment?.[0] as any;
        return comment
          ? {
              found: true,
              discussionChannelUniqueName:
                comment.DiscussionChannel?.channelUniqueName ?? null,
              directChannelUniqueName: comment.Channel?.uniqueName ?? null,
            }
          : {
              found: false,
              discussionChannelUniqueName: null,
              directChannelUniqueName: null,
            };
      },
      async findDiscussionChannelReference() {
        counters.discussionCalls += 1;
        const discussionChannel = rows.DiscussionChannel?.[0] as any;
        return discussionChannel
          ? {
              found: true,
              channelUniqueName: discussionChannel.channelUniqueName ?? null,
            }
          : { found: false, channelUniqueName: null };
      },
    },
    channelPermissionRepository: {
      async findAuthorizationSnapshot(channelName: string) {
        counters.permissionChannels.push(channelName);
        return null;
      },
      async findTargetedSuspensions() {
        return { userSuspensions: [], modSuspensions: [] };
      },
    },
    ogm: {
      model() {
        throw new Error("voting authorization must not use ogm.model");
      },
    },
  } as any;
}

const withChannelCtx = (extra: Record<string, unknown[]>) =>
  makeCtx({ ServerConfig: [{ Admins: [], SuperAdmins: [] }], ...extra });

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
  const counters = makeCounters();
  const ctx = makeCtx(
    {
      ServerConfig: [{ Admins: [], SuperAdmins: [] }],
      Comment: [{ id: "c-1", DiscussionChannel: null, Channel: { uniqueName: "cats" } }],
    },
    counters
  );
  await expectDeniedOrError(run(canUpvoteComment, { commentId: "c-1", username: "alice" }, ctx));
  assert.deepEqual(counters.permissionChannels, ["cats"]);
});

test("canUpvoteComment runs the permission check and denies without channel permission", async () => {
  const counters = makeCounters();
  const ctx = makeCtx(
    {
      ServerConfig: [{ Admins: [], SuperAdmins: [] }],
      Comment: [{
        id: "c-1",
        DiscussionChannel: { channelUniqueName: "cats" },
        Channel: { uniqueName: "dogs" },
      }],
    },
    counters
  );
  await expectDeniedOrError(run(canUpvoteComment, { commentId: "c-1", username: "alice" }, ctx));
  assert.deepEqual(counters.permissionChannels, ["cats"]);
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
  const counters = makeCounters();
  const ctx = makeCtx(
    { ServerConfig: [{ Admins: [], SuperAdmins: [] }] },
    counters
  );
  await expectDeniedOrError(
    run(canSuperUpvote, { sourceType: "comment", sourceId: "c-1", sourceChannelUniqueName: "cats" }, ctx)
  );
  assert.equal(counters.commentCalls, 0);
  assert.equal(counters.discussionCalls, 0);
  assert.deepEqual(counters.permissionChannels, ["cats"]);
});

test("canSuperUpvote preserves the missing-channel error for unknown sources", async () => {
  await assert.rejects(
    run(
      canSuperUpvote,
      { sourceType: "comment", sourceId: "missing" },
      makeCtx()
    ),
    /No channel found/
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

test("canUpvoteDiscussion distinguishes an entry without a channel name", async () => {
  await assert.rejects(
    run(
      canUpvoteDiscussion,
      { discussionChannelId: "dc-orphan", username: "alice" },
      makeCtx({ DiscussionChannel: [{ id: "dc-orphan" }] })
    ),
    /No channel found/
  );
});

test("canUpvoteDiscussion runs the permission check and denies without permission", async () => {
  const ctx = withChannelCtx({ DiscussionChannel: [{ id: "dc-1", channelUniqueName: "cats" }] });
  await expectDeniedOrError(run(canUpvoteDiscussion, { discussionChannelId: "dc-1", username: "alice" }, ctx));
});
