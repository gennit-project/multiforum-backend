import assert from "node:assert/strict";
import { evaluateServerPermission } from "./hasServerPermission.js";

const baseRole = (canCreateChannel: boolean, canUploadFile: boolean = true) => ({
  canCreateChannel,
  canUploadFile,
});

async function testSuspendedUsesDefaultSuspendedRole() {
  const result = evaluateServerPermission({
    permission: "canCreateChannel",
    userRoles: [],
    defaultServerRole: baseRole(true),
    defaultSuspendedRole: baseRole(false),
    hasActiveSuspension: true,
  });
  assert.ok(result instanceof Error, "Suspended user should be blocked if default suspended role disallows");
}

async function testSuspendedAllowedWhenSuspendedRoleAllows() {
  const result = evaluateServerPermission({
    permission: "canCreateChannel",
    userRoles: [],
    defaultServerRole: baseRole(false),
    defaultSuspendedRole: baseRole(true),
    hasActiveSuspension: true,
  });
  assert.equal(result, true, "Suspended user should follow suspended role allowance");
}

async function testFallsBackToDefaultServerRole() {
  const result = evaluateServerPermission({
    permission: "canCreateChannel",
    userRoles: [],
    defaultServerRole: baseRole(true),
    defaultSuspendedRole: baseRole(false),
    hasActiveSuspension: false,
  });
  assert.equal(result, true, "Non-suspended user should use default server role");
}

async function testUserRoleMustAllow() {
  const result = evaluateServerPermission({
    permission: "canCreateChannel",
    userRoles: [baseRole(false)],
    defaultServerRole: baseRole(true),
    defaultSuspendedRole: baseRole(false),
    hasActiveSuspension: false,
  });
  assert.ok(result instanceof Error, "Explicit user server role denying permission should block");
}

async function run() {
  await testSuspendedUsesDefaultSuspendedRole();
  await testSuspendedAllowedWhenSuspendedRoleAllows();
  await testFallsBackToDefaultServerRole();
  await testUserRoleMustAllow();
  console.log("hasServerPermission tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
