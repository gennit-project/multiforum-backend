import assert from "node:assert/strict";
import type { GraphQLContext } from "../../types/context.js";
import {
  evaluateServerPermission,
  hasServerPermission,
} from "./hasServerPermission.js";

const baseRole = (canCreateChannel: boolean, canUploadFile: boolean = true) => ({
  canCreateChannel,
  canUploadFile,
});

async function testSuspendedUsesDefaultSuspendedRole() {
  const result = evaluateServerPermission({
    permission: "canCreateChannel",
    defaultServerRole: baseRole(true),
    defaultSuspendedRole: baseRole(false),
    hasActiveSuspension: true,
  });
  assert.ok(result instanceof Error, "Suspended user should be blocked if default suspended role disallows");
}

async function testSuspendedAllowedWhenSuspendedRoleAllows() {
  const result = evaluateServerPermission({
    permission: "canCreateChannel",
    defaultServerRole: baseRole(false),
    defaultSuspendedRole: baseRole(true),
    hasActiveSuspension: true,
  });
  assert.equal(result, true, "Suspended user should follow suspended role allowance");
}

async function testFallsBackToDefaultServerRole() {
  const result = evaluateServerPermission({
    permission: "canCreateChannel",
    defaultServerRole: baseRole(true),
    defaultSuspendedRole: baseRole(false),
    hasActiveSuspension: false,
  });
  assert.equal(result, true, "Non-suspended user should use default server role");
}

async function testRootHoldsEveryCapability() {
  const result = evaluateServerPermission({
    permission: "canManageAdmins",
    defaultServerRole: { canManageAdmins: false } as any,
    hasActiveSuspension: false,
    isRoot: true,
  });
  assert.equal(result, true, "Env root should hold every capability unconditionally");
}

async function testSuperAdminUsesSuperAdminRole() {
  const result = evaluateServerPermission({
    permission: "canManageAdmins",
    defaultServerRole: { canManageAdmins: false } as any,
    hasActiveSuspension: false,
    isSuperAdmin: true,
    superAdminRole: { canManageAdmins: true } as any,
    adminRole: { canManageAdmins: false } as any,
  });
  assert.equal(result, true, "Super-admin should be evaluated against the super-admin role");
}

async function testRestrictedAdminCannotManageAdmins() {
  const adminRole = { canManagePlugins: true, canManageAdmins: false } as any;
  const canManagePlugins = evaluateServerPermission({
    permission: "canManagePlugins",
    defaultServerRole: {} as any,
    hasActiveSuspension: false,
    isAdmin: true,
    adminRole,
  });
  const canManageAdmins = evaluateServerPermission({
    permission: "canManageAdmins",
    defaultServerRole: {} as any,
    hasActiveSuspension: false,
    isAdmin: true,
    adminRole,
  });
  assert.equal(canManagePlugins, true, "Restricted admin keeps granted caps");
  assert.ok(canManageAdmins instanceof Error, "Restricted admin must not manage admins");
}

async function testTierFallsBackToDefaultRoleWhenUnseeded() {
  // Behavior-preserving: an admin with no admin role configured yet evaluates
  // against the default server role (as before the migration).
  const result = evaluateServerPermission({
    permission: "canCreateChannel",
    defaultServerRole: baseRole(true),
    hasActiveSuspension: false,
    isAdmin: true,
    adminRole: null,
  });
  assert.equal(result, true, "Unseeded tier role falls back to the default server role");
}

async function testSuspendedAdminUsesSuspendedRole() {
  const result = evaluateServerPermission({
    permission: "canCreateChannel",
    defaultServerRole: baseRole(true),
    defaultSuspendedRole: baseRole(false),
    hasActiveSuspension: true,
    isAdmin: true,
    adminRole: { canCreateChannel: true } as any,
  });
  assert.ok(result instanceof Error, "A suspended admin is restricted by the suspended role");
}

async function testGenericCapabilityViaRole() {
  const granted = evaluateServerPermission({
    permission: "canManageServerSettings",
    defaultServerRole: { canManageServerSettings: true } as any,
    hasActiveSuspension: false,
  });
  const denied = evaluateServerPermission({
    permission: "canManageServerSettings",
    defaultServerRole: { canManageServerSettings: false } as any,
    hasActiveSuspension: false,
  });
  assert.equal(granted, true, "Any capability works generically via the role");
  assert.ok(denied instanceof Error, "Generic capability is denied when the role lacks it");
}

async function testHasServerPermissionCachesRequestLookups() {
  let suspensionQueryCalls = 0;
  let serverConfigFindCalls = 0;
  const context = {
    driver: {
      session: () => ({
        run: async (query: string) => {
          if (query.includes("MATCH (serverConfig)-[:SUSPENDED_AS_USER]->")) {
            suspensionQueryCalls += 1;
            return { records: [] };
          }

          if (query.includes("MATCH (serverConfig)-[:SUSPENDED_AS_MOD]->")) {
            return { records: [] };
          }

          throw new Error(`Unexpected query: ${query}`);
        },
        close: async () => {},
      }),
    },
    user: {
      username: "alice",
      data: {
      },
    },
    req: {
      headers: {},
    },
    ogm: {
      model(name: string) {
        if (name === "ServerConfig") {
          return {
            find: async () => {
              serverConfigFindCalls += 1;
              return [
                {
                  DefaultServerRole: {
                    canCreateChannel: true,
                    canUploadFile: true,
                  },
                  DefaultSuspendedRole: {
                    canCreateChannel: false,
                    canUploadFile: false,
                  },
                  Admins: [],
                  Moderators: [],
                },
              ];
            },
          };
        }

        if (name === "User") {
          return {
            find: async () => [],
            update: async () => ({}),
          };
        }

        throw new Error(`Unexpected model lookup: ${name}`);
      },
    },
  };

  await hasServerPermission("canCreateChannel", context as unknown as GraphQLContext);
  await hasServerPermission("canCreateChannel", context as unknown as GraphQLContext);

  assert.deepEqual({
    suspensionQueryCalls,
    serverConfigFindCalls,
  }, {
    suspensionQueryCalls: 2,
    serverConfigFindCalls: 1,
  });
}

async function run() {
  await testSuspendedUsesDefaultSuspendedRole();
  await testSuspendedAllowedWhenSuspendedRoleAllows();
  await testFallsBackToDefaultServerRole();
  await testRootHoldsEveryCapability();
  await testSuperAdminUsesSuperAdminRole();
  await testRestrictedAdminCannotManageAdmins();
  await testTierFallsBackToDefaultRoleWhenUnseeded();
  await testSuspendedAdminUsesSuspendedRole();
  await testGenericCapabilityViaRole();
  await testHasServerPermissionCachesRequestLookups();
  console.log("hasServerPermission tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
