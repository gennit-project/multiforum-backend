import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveEffectiveServerRole,
  resolveEffectiveModServerRole,
} from "./actorCapabilities.js";

// Pure tier selection for the actor's effective role (used by the
// no-privilege-escalation guard). Mirrors hasServerPermission /
// hasServerModPermission. See docs/isadmin-phaseout-design.md.

const serverRoles = {
  defaultServerRole: { canCreateChannel: true, canManageAdmins: false },
  defaultSuspendedRole: { canCreateChannel: false, canManageAdmins: false },
  adminRole: { canManageRoles: true, canManageAdmins: false },
  superAdminRole: { canManageRoles: true, canManageAdmins: true },
};

test("resolveEffectiveServerRole: root holds everything", () => {
  assert.equal(
    resolveEffectiveServerRole({
      isRoot: true,
      isSuperAdmin: false,
      isAdmin: false,
      hasActiveSuspension: false,
      ...serverRoles,
    }),
    "all"
  );
});

test("resolveEffectiveServerRole: super-admin resolves the super-admin role", () => {
  assert.equal(
    resolveEffectiveServerRole({
      isRoot: false,
      isSuperAdmin: true,
      isAdmin: false,
      hasActiveSuspension: false,
      ...serverRoles,
    }),
    serverRoles.superAdminRole
  );
});

test("resolveEffectiveServerRole: admin resolves the (restricted) admin role", () => {
  assert.equal(
    resolveEffectiveServerRole({
      isRoot: false,
      isSuperAdmin: false,
      isAdmin: true,
      hasActiveSuspension: false,
      ...serverRoles,
    }),
    serverRoles.adminRole
  );
});

test("resolveEffectiveServerRole: suspension beats tier", () => {
  assert.equal(
    resolveEffectiveServerRole({
      isRoot: false,
      isSuperAdmin: true,
      isAdmin: true,
      hasActiveSuspension: true,
      ...serverRoles,
    }),
    serverRoles.defaultSuspendedRole
  );
});

test("resolveEffectiveServerRole: a plain user resolves the default role", () => {
  assert.equal(
    resolveEffectiveServerRole({
      isRoot: false,
      isSuperAdmin: false,
      isAdmin: false,
      hasActiveSuspension: false,
      ...serverRoles,
    }),
    serverRoles.defaultServerRole
  );
});

const modRoles = {
  defaultModRole: { canReport: true, canRemoveDiscussionChannel: false },
  defaultElevatedModRole: { canReport: true, canRemoveDiscussionChannel: true },
  defaultSuspendedModRole: { canReport: false, canRemoveDiscussionChannel: false },
};

test("resolveEffectiveModServerRole: root and admin hold every mod capability", () => {
  assert.equal(
    resolveEffectiveModServerRole({
      isRoot: true,
      isAdmin: false,
      isModerator: false,
      hasActiveSuspension: false,
      ...modRoles,
    }),
    "all"
  );
  assert.equal(
    resolveEffectiveModServerRole({
      isRoot: false,
      isAdmin: true,
      isModerator: false,
      hasActiveSuspension: false,
      ...modRoles,
    }),
    "all"
  );
});

test("resolveEffectiveModServerRole: a suspended admin loses the full bundle", () => {
  assert.equal(
    resolveEffectiveModServerRole({
      isRoot: false,
      isAdmin: true,
      isModerator: false,
      hasActiveSuspension: true,
      ...modRoles,
    }),
    modRoles.defaultSuspendedModRole
  );
});

test("resolveEffectiveModServerRole: a moderator resolves the elevated role", () => {
  assert.equal(
    resolveEffectiveModServerRole({
      isRoot: false,
      isAdmin: false,
      isModerator: true,
      hasActiveSuspension: false,
      ...modRoles,
    }),
    modRoles.defaultElevatedModRole
  );
});

test("resolveEffectiveModServerRole: a plain user resolves the default mod role", () => {
  assert.equal(
    resolveEffectiveModServerRole({
      isRoot: false,
      isAdmin: false,
      isModerator: false,
      hasActiveSuspension: false,
      ...modRoles,
    }),
    modRoles.defaultModRole
  );
});
