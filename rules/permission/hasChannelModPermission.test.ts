// Unit tests for the pure mod-permission decision extracted from
// hasChannelModPermission. Covers the role-selection matrix (suspended >
// elevated > default), server-config fallback, and the strict grant semantics.
import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateChannelModPermission,
  ModChannelPermission,
} from "./hasChannelModPermission.js";

const P = ModChannelPermission;

const evalPerm = (overrides: Partial<Parameters<typeof evaluateChannelModPermission>[0]>) =>
  evaluateChannelModPermission({
    permission: P.canReport,
    channelData: { Moderators: [] },
    serverDefaults: undefined,
    isSuspended: false,
    modProfileName: "mod-a",
    ...overrides,
  });

test("the default mod role governs a regular user and grants its permissions", () => {
  const r = evalPerm({ channelData: { DefaultModRole: { canReport: true }, Moderators: [] } });
  assert.equal(r.allowed, true);
  assert.deepEqual(r.role, { canReport: true });
});

test("denies when the governing role lacks the permission", () => {
  const r = evalPerm({ channelData: { DefaultModRole: { canReport: false }, Moderators: [] } });
  assert.equal(r.allowed, false);
});

test("only an exact `true` grants — absent/null/undefined are denied", () => {
  for (const role of [{}, { canReport: null }, { canReport: undefined }]) {
    const r = evalPerm({ channelData: { DefaultModRole: role, Moderators: [] } });
    assert.equal(r.allowed, false);
  }
});

test("an elevated moderator (listed in Moderators) uses the elevated role", () => {
  const r = evalPerm({
    channelData: {
      DefaultModRole: { canReport: false },
      ElevatedModRole: { canReport: true },
      Moderators: [{ displayName: "mod-a" }],
    },
  });
  assert.equal(r.allowed, true);
  assert.deepEqual(r.role, { canReport: true });
});

test("a user not listed in Moderators does not get the elevated role", () => {
  const r = evalPerm({
    channelData: {
      DefaultModRole: { canReport: false },
      ElevatedModRole: { canReport: true },
      Moderators: [{ displayName: "someone-else" }],
    },
  });
  assert.equal(r.allowed, false); // default role applies
});

test("suspension takes precedence over elevated status", () => {
  const r = evalPerm({
    isSuspended: true,
    channelData: {
      SuspendedModRole: { canReport: false },
      ElevatedModRole: { canReport: true },
      Moderators: [{ displayName: "mod-a" }],
    },
  });
  assert.equal(r.allowed, false); // suspended role used despite being an elevated mod
  assert.deepEqual(r.role, { canReport: false });
});

test("falls back to the matching server default role when the channel defines none", () => {
  const def = evalPerm({
    channelData: { Moderators: [] },
    serverDefaults: { DefaultModRole: { canReport: true } },
  });
  assert.equal(def.allowed, true);

  const elevated = evalPerm({
    channelData: { Moderators: [{ displayName: "mod-a" }] },
    serverDefaults: { DefaultElevatedModRole: { canReport: true } },
  });
  assert.equal(elevated.allowed, true);

  const suspended = evalPerm({
    isSuspended: true,
    channelData: {},
    serverDefaults: { DefaultSuspendedModRole: { canReport: true } },
  });
  assert.equal(suspended.allowed, true);
});

test("a channel role takes precedence over the server default", () => {
  const r = evalPerm({
    channelData: { DefaultModRole: { canReport: false }, Moderators: [] },
    serverDefaults: { DefaultModRole: { canReport: true } },
  });
  assert.equal(r.allowed, false); // channel's role (deny) wins over server default (allow)
});

test("returns a null role when neither channel nor server defines one", () => {
  const r = evalPerm({ channelData: { Moderators: [] }, serverDefaults: undefined });
  assert.equal(r.role, null);
  assert.equal(r.allowed, false);
});

test("checks the specific permission requested, not others", () => {
  const r = evalPerm({
    permission: P.canSuspendUser,
    channelData: { DefaultModRole: { canReport: true, canSuspendUser: false }, Moderators: [] },
  });
  assert.equal(r.allowed, false);
});
