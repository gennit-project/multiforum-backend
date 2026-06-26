import test from "node:test";
import assert from "node:assert/strict";
import { extractNestedRoleWrites } from "./nestedRoleEscalation.js";
import { findEscalatedCapabilities } from "./roleEscalation.js";
import {
  SERVER_ROLE_CAPABILITY_FIELDS,
  type EffectiveRole,
} from "../permission/actorCapabilities.js";

// PR-4b: the nested role-escalation guard for ServerConfig mutations.
// extractNestedRoleWrites pulls capability-bearing role nodes and connect
// `where`s out of the (auto-generated) ServerConfig create/update input, across
// all create/update/connect/connectOrCreate shapes.

test("extracts a nested update node on a ServerRole tier relationship", () => {
  const writes = extractNestedRoleWrites({
    DefaultAdminRole: { update: { node: { canManageAdmins: true } } },
  });
  assert.deepEqual(writes.serverRoleNodes, [{ canManageAdmins: true }]);
  assert.deepEqual(writes.modServerRoleNodes, []);
});

test("extracts a nested create node on a ServerRole tier relationship", () => {
  const writes = extractNestedRoleWrites({
    DefaultServerRole: { create: { node: { canCreateChannel: true } } },
  });
  assert.deepEqual(writes.serverRoleNodes, [{ canCreateChannel: true }]);
});

test("extracts connectOrCreate onCreate nodes and connect wheres", () => {
  const writes = extractNestedRoleWrites({
    DefaultAdminRole: {
      connectOrCreate: {
        where: { node: { name: "Super Administrator" } },
        onCreate: { node: { canManageSuperAdmins: true } },
      },
    },
  });
  assert.deepEqual(writes.serverRoleNodes, [{ canManageSuperAdmins: true }]);
  assert.deepEqual(writes.serverRoleConnectWheres, [{ name: "Super Administrator" }]);
});

test("extracts a connect where (connecting an existing role into a tier slot)", () => {
  const writes = extractNestedRoleWrites({
    DefaultServerRole: { connect: { where: { node: { name: "Super Administrator" } } } },
  });
  assert.deepEqual(writes.serverRoleConnectWheres, [{ name: "Super Administrator" }]);
  assert.deepEqual(writes.serverRoleNodes, []);
});

test("routes mod-role relationships to the mod buckets", () => {
  const writes = extractNestedRoleWrites({
    DefaultModRole: { update: { node: { canRemoveDiscussionChannel: true } } },
    DefaultElevatedModRole: { connect: { where: { node: { name: "Full Mod" } } } },
  });
  assert.deepEqual(writes.modServerRoleNodes, [{ canRemoveDiscussionChannel: true }]);
  assert.deepEqual(writes.modServerRoleConnectWheres, [{ name: "Full Mod" }]);
  assert.deepEqual(writes.serverRoleNodes, []);
});

test("handles array-shaped relationship inputs defensively", () => {
  const writes = extractNestedRoleWrites({
    DefaultAdminRole: [
      { update: { node: { canManageAdmins: true } } },
      { create: { node: { canManageRoles: true } } },
    ],
  });
  assert.deepEqual(writes.serverRoleNodes, [
    { canManageAdmins: true },
    { canManageRoles: true },
  ]);
});

test("ignores non-role fields and empty/invalid input", () => {
  assert.deepEqual(extractNestedRoleWrites({ name: "My Server", description: "x" }), {
    serverRoleNodes: [],
    modServerRoleNodes: [],
    serverRoleConnectWheres: [],
    modServerRoleConnectWheres: [],
  });
  assert.deepEqual(extractNestedRoleWrites(null).serverRoleNodes, []);
  assert.deepEqual(extractNestedRoleWrites("nope").serverRoleNodes, []);
});

test("end to end: a nested DefaultAdminRole.update escalates for a restricted admin", () => {
  // The exact apex-escalation attack: a restricted admin (canManageRoles but not
  // canManageAdmins) edits the shared admin tier role to grant canManageAdmins.
  const writes = extractNestedRoleWrites({
    DefaultAdminRole: { update: { node: { canManageAdmins: true, canManageRoles: true } } },
  });
  const restrictedAdmin: EffectiveRole = {
    canManageRoles: true,
    canManageAdmins: false,
  };
  const escalated = findEscalatedCapabilities({
    requested: writes.serverRoleNodes,
    capabilityFields: SERVER_ROLE_CAPABILITY_FIELDS,
    actorRole: restrictedAdmin,
  });
  assert.deepEqual(escalated, ["canManageAdmins"]);
});

test("end to end: the same nested edit is allowed for root ('all')", () => {
  const writes = extractNestedRoleWrites({
    DefaultAdminRole: { update: { node: { canManageAdmins: true } } },
  });
  const escalated = findEscalatedCapabilities({
    requested: writes.serverRoleNodes,
    capabilityFields: SERVER_ROLE_CAPABILITY_FIELDS,
    actorRole: "all",
  });
  assert.deepEqual(escalated, []);
});
