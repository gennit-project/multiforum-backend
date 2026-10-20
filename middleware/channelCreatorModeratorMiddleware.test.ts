// Unit tests for the channel creator-moderator middleware. After createChannels
// runs, it resolves the logged-in user's ModerationProfile and connects them as a
// moderator of each newly created channel. setUserDataOnContext short-circuits on
// a pre-set context.user (no DB), so these tests drive the middleware's branching
// — anonymous caller, no mod profile, no channels, per-channel update, the
// unique-name skip, and both the inner (per-channel) and outer error paths —
// against the real middleware with a stubbed assignment service.
import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import middleware from "./channelCreatorModeratorMiddleware.js";

const M: any = (middleware as any).Mutation;

// Build a ctx. `user` is placed on context.user so setUserDataOnContext returns
// it without a DB lookup. The assignment service is stubbed;
// `updates` records the channels a Moderator connect was attempted on.
function makeCtx(opts: {
  user?: {
    username: string;
    data?: { ModerationProfile?: { displayName?: string | null } | null } | null;
  } | undefined;
  channelUpdate?: (args: any) => Promise<unknown>;
} = {}) {
  const updates: string[] = [];
  const ogm = { model() { throw new Error("Assignment must not use OGM"); } };
  const ctx: any = { ogm, driver: {}, req: { headers: {} },
    channelCreatorModeratorService: {
      assign: async (channelUniqueName: string, displayName: string) => {
        updates.push(channelUniqueName);
        if (opts.channelUpdate) await opts.channelUpdate({ where: { uniqueName: channelUniqueName }, displayName });
      },
    },
  };
  if (opts.user) ctx.user = opts.user;
  return { ctx, updates };
}

function resolveReturning(result: unknown) {
  const state = { calls: 0 };
  const resolve = async () => {
    state.calls += 1;
    return result;
  };
  return { resolve, state };
}

const userWithProfile = {
  username: "alice",
  data: { ModerationProfile: { displayName: "Mod Alice" } },
};

test("connects the creator as moderator of each created channel", async () => {
  const { ctx, updates } = makeCtx({ user: userWithProfile });
  const { resolve, state } = resolveReturning({
    channels: [{ uniqueName: "cats" }, { uniqueName: "dogs" }],
  });
  const out = await M.createChannels(resolve, null, {}, ctx, {});
  assert.equal(state.calls, 1);
  assert.deepEqual(updates, ["cats", "dogs"]);
  assert.deepEqual(out, { channels: [{ uniqueName: "cats" }, { uniqueName: "dogs" }] });
});

test("skips moderator assignment for an anonymous caller", async () => {
  const { ctx, updates } = makeCtx({ user: undefined }); // no context.user, no token
  const { resolve } = resolveReturning({ channels: [{ uniqueName: "cats" }] });
  const out = await M.createChannels(resolve, null, {}, ctx, {});
  assert.deepEqual(updates, []); // never reached the update
  assert.deepEqual(out, { channels: [{ uniqueName: "cats" }] });
});

test("skips when the user has no ModerationProfile", async () => {
  const { ctx, updates } = makeCtx({ user: { username: "alice", data: null } });
  const { resolve } = resolveReturning({ channels: [{ uniqueName: "cats" }] });
  const out = await M.createChannels(resolve, null, {}, ctx, {});
  assert.deepEqual(updates, []);
  assert.deepEqual(out, { channels: [{ uniqueName: "cats" }] });
});

test("returns early when there are no created channels", async () => {
  const { ctx, updates } = makeCtx({ user: userWithProfile });
  const { resolve } = resolveReturning({ channels: [] });
  const out = await M.createChannels(resolve, null, {}, ctx, {});
  assert.deepEqual(updates, []);
  assert.deepEqual(out, { channels: [] });
});

test("skips channels without a uniqueName", async () => {
  const { ctx, updates } = makeCtx({ user: userWithProfile });
  const { resolve } = resolveReturning({ channels: [{}, { uniqueName: "cats" }] as any });
  await M.createChannels(resolve, null, {}, ctx, {});
  assert.deepEqual(updates, ["cats"]); // only the named channel updated
});

test("a failed assignment is logged but does not fail channel creation", async () => {
  const { ctx } = makeCtx({
    user: userWithProfile,
    channelUpdate: async () => {
      throw new Error("update boom");
    },
  });
  const { resolve, state } = resolveReturning({ channels: [{ uniqueName: "cats" }] });
  const out = await M.createChannels(resolve, null, {}, ctx, {});
  assert.equal(state.calls, 1);
  assert.deepEqual(out, { channels: [{ uniqueName: "cats" }] }); // still returns
});

test("an error while loading request identity is swallowed", async () => {
  const previousMockAuth = process.env.PLAYWRIGHT_MOCK_AUTH;
  process.env.PLAYWRIGHT_MOCK_AUTH = "true";
  const ctx: any = {
    ogm: {
      model(name: string) {
        return { find: async () => [], update: async () => ({}) };
      },
    },
    driver: {},
    requestIdentityRepository: {
      findByUsername: async () => {
        throw new Error("db down");
      },
      findByEmail: async () => null,
      userExists: async () => false,
    },
    req: {
      headers: {
        authorization: `Bearer ${jwt.sign({ username: "alice" }, "test")}`,
      },
    },
  };
  const { resolve, state } = resolveReturning({ channels: [{ uniqueName: "cats" }] });
  try {
    const out = await M.createChannels(resolve, null, {}, ctx, {});
    assert.equal(state.calls, 1);
    assert.deepEqual(out, { channels: [{ uniqueName: "cats" }] });
  } finally {
    if (previousMockAuth === undefined) {
      delete process.env.PLAYWRIGHT_MOCK_AUTH;
    } else {
      process.env.PLAYWRIGHT_MOCK_AUTH = previousMockAuth;
    }
  }
});


test("per-channel assignments are awaited in order and continue after a failure", async () => {
  const finished: string[] = [];
  const { ctx, updates } = makeCtx({ user: userWithProfile, channelUpdate: async (args) => {
    assert.equal(finished.length, updates.length - 1);
    await Promise.resolve();
    finished.push(args.where.uniqueName);
    if (args.where.uniqueName === "cats") throw new Error("first channel failed");
  } });
  const { resolve } = resolveReturning({ channels: [{ uniqueName: "cats" }, { uniqueName: "dogs" }] });
  await M.createChannels(resolve, null, {}, ctx, {});
  assert.deepEqual(finished, ["cats", "dogs"]);
});
