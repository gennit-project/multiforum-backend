import assert from "node:assert/strict";
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
        ServerRoles: [],
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

  await hasServerPermission("canCreateChannel", context);
  await hasServerPermission("canCreateChannel", context);

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
  await testUserRoleMustAllow();
  await testHasServerPermissionCachesRequestLookups();
  console.log("hasServerPermission tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
