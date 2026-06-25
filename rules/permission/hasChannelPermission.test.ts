// Unit tests for the pure channel-permission decisions extracted from
// hasChannelPermission: the admin (owner) short-circuit and the role-selection
// matrix (suspended vs default, with server-config fallback).
import assert from "node:assert/strict";
import test from "node:test";
import {
  isChannelAdmin,
  evaluateChannelRolePermission,
} from "./hasChannelPermission.js";

const PERM = "canCreateComment";

test("isChannelAdmin matches a user listed in the channel admins", () => {
  const admins = [{ username: "alice" }, { username: "bob" }];
  assert.equal(isChannelAdmin(admins, "alice"), true);
  assert.equal(isChannelAdmin(admins, "carol"), false);
});

test("isChannelAdmin is false for empty/missing admins or username", () => {
  assert.equal(isChannelAdmin([], "alice"), false);
  assert.equal(isChannelAdmin(null, "alice"), false);
  assert.equal(isChannelAdmin(undefined, "alice"), false);
  assert.equal(isChannelAdmin([{ username: "alice" }], null), false);
  assert.equal(isChannelAdmin([{ username: "alice" }], undefined), false);
});

const evalPerm = (overrides: Partial<Parameters<typeof evaluateChannelRolePermission>[0]>) =>
  evaluateChannelRolePermission({
    permission: PERM,
    channelData: {},
    serverDefaults: undefined,
    isSuspended: false,
    ...overrides,
  });

test("the default channel role governs a normal user", () => {
  const granted = evalPerm({ channelData: { DefaultChannelRole: { [PERM]: true } } });
  assert.equal(granted.allowed, true);
  assert.deepEqual(granted.role, { [PERM]: true });

  const denied = evalPerm({ channelData: { DefaultChannelRole: { [PERM]: false } } });
  assert.equal(denied.allowed, false);
});

test("a suspended user is governed by the suspended role", () => {
  const r = evalPerm({
    isSuspended: true,
    channelData: { DefaultChannelRole: { [PERM]: true }, SuspendedRole: { [PERM]: false } },
  });
  assert.equal(r.allowed, false);
  assert.deepEqual(r.role, { [PERM]: false });
});

test("falls back to the server default role when the channel defines none", () => {
  const normal = evalPerm({
    channelData: {},
    serverDefaults: { DefaultServerRole: { [PERM]: true } },
  });
  assert.equal(normal.allowed, true);

  const suspended = evalPerm({
    isSuspended: true,
    channelData: {},
    serverDefaults: { DefaultSuspendedRole: { [PERM]: true } },
  });
  assert.equal(suspended.allowed, true);
});

test("a channel role takes precedence over the server default", () => {
  const r = evalPerm({
    channelData: { DefaultChannelRole: { [PERM]: false } },
    serverDefaults: { DefaultServerRole: { [PERM]: true } },
  });
  assert.equal(r.allowed, false); // channel deny wins over server allow
});

test("only an exact `true` grants — absent/null/undefined are denied", () => {
  for (const role of [{}, { [PERM]: null }, { [PERM]: undefined }]) {
    const r = evalPerm({ channelData: { DefaultChannelRole: role } });
    assert.equal(r.allowed, false);
  }
});

test("returns a null role when neither channel nor server defines one", () => {
  const r = evalPerm({ channelData: {}, serverDefaults: undefined });
  assert.equal(r.role, null);
  assert.equal(r.allowed, false);
});

test("checks the specific permission requested, not others", () => {
  const r = evalPerm({
    permission: "canUploadFile",
    channelData: { DefaultChannelRole: { canCreateComment: true, canUploadFile: false } },
  });
  assert.equal(r.allowed, false);
});
