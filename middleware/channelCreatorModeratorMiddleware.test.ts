// Unit tests for the channel creator-moderator middleware. After createChannels
// runs, it resolves the logged-in user's ModerationProfile and connects them as a
// moderator of each newly created channel. setUserDataOnContext short-circuits on
// a pre-set context.user (no DB), so these tests drive the middleware's branching
// — anonymous caller, no mod profile, no channels, per-channel update, the
// unique-name skip, and both the inner (per-channel) and outer error paths —
// against the REAL middleware with a stubbed resolver and a permissive in-memory
// OGM. (Replaces an older test that exercised an inline copy of the logic and so
// covered none of the real module.)
import assert from "node:assert/strict";
import test from "node:test";
import middleware from "./channelCreatorModeratorMiddleware.js";

const M: any = (middleware as any).Mutation;

// Build a ctx. `user` is placed on context.user so setUserDataOnContext returns
// it without a DB lookup. User.find/Channel.update come from `models`. `updates`
// records the channels a Moderator connect was attempted on.
function makeCtx(opts: {
  user?: { username: string } | undefined;
  userRows?: unknown[];
  channelUpdate?: (args: any) => Promise<unknown>;
} = {}) {
  const updates: string[] = [];
  const ogm = {
    model(name: string) {
      if (name === "User") {
        return { find: async () => opts.userRows ?? [] };
      }
      if (name === "Channel") {
        return {
          update: async (args: any) => {
            updates.push(args?.where?.uniqueName);
            return opts.channelUpdate ? opts.channelUpdate(args) : {};
          },
        };
      }
      return { find: async () => [], update: async () => ({}) };
    },
  };
  const ctx: any = { ogm, driver: {}, req: { headers: {} } };
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

const withProfile = [{ ModerationProfile: { displayName: "Mod Alice" } }];

test("connects the creator as moderator of each created channel", async () => {
  const { ctx, updates } = makeCtx({ user: { username: "alice" }, userRows: withProfile });
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
  const { ctx, updates } = makeCtx({ user: { username: "alice" }, userRows: [{}] });
  const { resolve } = resolveReturning({ channels: [{ uniqueName: "cats" }] });
  const out = await M.createChannels(resolve, null, {}, ctx, {});
  assert.deepEqual(updates, []);
  assert.deepEqual(out, { channels: [{ uniqueName: "cats" }] });
});

test("returns early when there are no created channels", async () => {
  const { ctx, updates } = makeCtx({ user: { username: "alice" }, userRows: withProfile });
  const { resolve } = resolveReturning({ channels: [] });
  const out = await M.createChannels(resolve, null, {}, ctx, {});
  assert.deepEqual(updates, []);
  assert.deepEqual(out, { channels: [] });
});

test("skips channels without a uniqueName", async () => {
  const { ctx, updates } = makeCtx({ user: { username: "alice" }, userRows: withProfile });
  const { resolve } = resolveReturning({ channels: [{}, { uniqueName: "cats" }] as any });
  await M.createChannels(resolve, null, {}, ctx, {});
  assert.deepEqual(updates, ["cats"]); // only the named channel updated
});

test("a failed Channel.update is logged but does not fail channel creation", async () => {
  const { ctx } = makeCtx({
    user: { username: "alice" },
    userRows: withProfile,
    channelUpdate: async () => {
      throw new Error("update boom");
    },
  });
  const { resolve, state } = resolveReturning({ channels: [{ uniqueName: "cats" }] });
  const out = await M.createChannels(resolve, null, {}, ctx, {});
  assert.equal(state.calls, 1);
  assert.deepEqual(out, { channels: [{ uniqueName: "cats" }] }); // still returns
});

test("an error while resolving the moderator profile is swallowed", async () => {
  // User.find throws -> caught by the outer try/catch; the result still returns.
  const ctx: any = {
    ogm: {
      model(name: string) {
        if (name === "User") return { find: async () => { throw new Error("db down"); } };
        return { find: async () => [], update: async () => ({}) };
      },
    },
    driver: {},
    req: { headers: {} },
    user: { username: "alice" },
  };
  const { resolve, state } = resolveReturning({ channels: [{ uniqueName: "cats" }] });
  const out = await M.createChannels(resolve, null, {}, ctx, {});
  assert.equal(state.calls, 1);
  assert.deepEqual(out, { channels: [{ uniqueName: "cats" }] });
});
