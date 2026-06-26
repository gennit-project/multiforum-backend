import test from "node:test";
import assert from "node:assert/strict";
import {
  findEscalatedCapabilities,
  collectRequestedRoles,
} from "./roleEscalation.js";

// The no-privilege-escalation guard (docs/isadmin-phaseout-design.md §5).
// findEscalatedCapabilities returns the capabilities an input tries to grant
// that the actor does not hold.

const SERVER_CAPS = [
  "canManageRoles",
  "canManageAdmins",
  "canCreateChannel",
] as const;

test("root (actorRole 'all') never escalates", () => {
  const escalated = findEscalatedCapabilities({
    requested: [{ canManageAdmins: true, canManageRoles: true }],
    capabilityFields: SERVER_CAPS,
    actorRole: "all",
  });
  assert.deepEqual(escalated, []);
});

test("flags a capability the actor lacks", () => {
  // Restricted admin: has canManageRoles, NOT canManageAdmins.
  const escalated = findEscalatedCapabilities({
    requested: [{ canManageRoles: true, canManageAdmins: true }],
    capabilityFields: SERVER_CAPS,
    actorRole: { canManageRoles: true, canManageAdmins: false, canCreateChannel: true },
  });
  assert.deepEqual(escalated, ["canManageAdmins"]);
});

test("allows granting capabilities the actor holds", () => {
  const escalated = findEscalatedCapabilities({
    requested: [{ canManageRoles: true, canCreateChannel: true }],
    capabilityFields: SERVER_CAPS,
    actorRole: { canManageRoles: true, canManageAdmins: false, canCreateChannel: true },
  });
  assert.deepEqual(escalated, []);
});

test("a null actor role grants nothing (fail closed)", () => {
  const escalated = findEscalatedCapabilities({
    requested: [{ canManageRoles: true }],
    capabilityFields: SERVER_CAPS,
    actorRole: null,
  });
  assert.deepEqual(escalated, ["canManageRoles"]);
});

test("setting a capability to false or null is never an escalation", () => {
  const escalated = findEscalatedCapabilities({
    requested: [{ canManageAdmins: false, canManageRoles: null }],
    capabilityFields: SERVER_CAPS,
    actorRole: null,
  });
  assert.deepEqual(escalated, []);
});

test("deduplicates across multiple requested role items", () => {
  const escalated = findEscalatedCapabilities({
    requested: [
      { canManageAdmins: true },
      { canManageAdmins: true, canCreateChannel: true },
      null,
    ],
    capabilityFields: SERVER_CAPS,
    actorRole: { canCreateChannel: true },
  });
  assert.deepEqual(escalated.sort(), ["canManageAdmins"]);
});

test("ignores non-capability fields in the input (name, description, …)", () => {
  const escalated = findEscalatedCapabilities({
    requested: [{ name: "Editor", description: "x", canManageAdmins: true }],
    capabilityFields: SERVER_CAPS,
    actorRole: { canManageRoles: true },
  });
  assert.deepEqual(escalated, ["canManageAdmins"]);
});

test("collectRequestedRoles: reads create `input` array items", () => {
  const collected = collectRequestedRoles({
    input: [{ name: "A", canManageRoles: true }, { name: "B" }],
  });
  assert.deepEqual(collected, [
    { name: "A", canManageRoles: true },
    { name: "B" },
  ]);
});

test("collectRequestedRoles: reads the update object", () => {
  const collected = collectRequestedRoles({
    update: { canManageAdmins: true },
    where: { name: "Editor" },
  });
  assert.deepEqual(collected, [{ canManageAdmins: true }]);
});

test("collectRequestedRoles: no input or update yields an empty list", () => {
  assert.deepEqual(collectRequestedRoles({ where: { name: "Editor" } }), []);
});
