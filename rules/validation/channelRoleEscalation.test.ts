import test from "node:test";
import assert from "node:assert/strict";
import { roleItemsGrantingCapabilities } from "./channelRoleEscalation.js";
import {
  CHANNEL_ROLE_CAPABILITY_FIELDS,
  MOD_CHANNEL_ROLE_CAPABILITY_FIELDS,
} from "../permission/actorCapabilities.js";

// PR-4c: channel-role authoring guard. roleItemsGrantingCapabilities selects the
// input items that actually grant a capability — only those require the caller
// to own the target channel (or be a server admin / root).

test("selects only items that set a channel capability to true", () => {
  const items = [
    { channelUniqueName: "cats", name: "Reader" }, // no caps -> harmless
    { channelUniqueName: "cats", canUpdateChannel: true }, // grants a cap
    { channelUniqueName: "dogs", canUploadFile: false }, // explicitly false
  ];
  const granting = roleItemsGrantingCapabilities(items, CHANNEL_ROLE_CAPABILITY_FIELDS);
  assert.deepEqual(granting, [{ channelUniqueName: "cats", canUpdateChannel: true }]);
});

test("an all-false / capability-free role grants nothing", () => {
  const items = [
    { channelUniqueName: "cats", name: "Reader", description: "x" },
  ];
  assert.deepEqual(
    roleItemsGrantingCapabilities(items, CHANNEL_ROLE_CAPABILITY_FIELDS),
    []
  );
});

test("works for mod-channel capabilities", () => {
  const items = [
    { channelUniqueName: "cats", canSuspendUser: true },
    { channelUniqueName: "cats", name: "Helper" },
  ];
  const granting = roleItemsGrantingCapabilities(
    items,
    MOD_CHANNEL_ROLE_CAPABILITY_FIELDS
  );
  assert.deepEqual(granting, [{ channelUniqueName: "cats", canSuspendUser: true }]);
});

test("ignores a server-administration field that is not a channel capability", () => {
  // canManageAdmins is not a ChannelRole capability, so it must not count as a
  // granted channel capability (channel roles can't carry it anyway).
  const items = [{ channelUniqueName: "cats", canManageAdmins: true }];
  assert.deepEqual(
    roleItemsGrantingCapabilities(items, CHANNEL_ROLE_CAPABILITY_FIELDS),
    []
  );
});

test("handles non-array / empty / junk input", () => {
  assert.deepEqual(roleItemsGrantingCapabilities(undefined, CHANNEL_ROLE_CAPABILITY_FIELDS), []);
  assert.deepEqual(roleItemsGrantingCapabilities([], CHANNEL_ROLE_CAPABILITY_FIELDS), []);
  assert.deepEqual(
    roleItemsGrantingCapabilities([null, "x", 3], CHANNEL_ROLE_CAPABILITY_FIELDS),
    []
  );
});
