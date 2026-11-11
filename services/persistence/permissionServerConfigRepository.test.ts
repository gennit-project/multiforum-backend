import assert from "node:assert/strict";
import test from "node:test";
import neo4j, { type Driver } from "neo4j-driver";
import {
  createPermissionServerConfigRepository,
  PERMISSION_SERVER_CONFIG_QUERY,
} from "./permissionServerConfigRepository.js";

test("findByName uses the configured database and leader routing", async () => {
  const sessionConfigs: unknown[] = [];
  const runCalls: unknown[][] = [];
  let closeCalls = 0;
  const driver = {
    session(config: unknown) {
      sessionConfigs.push(config);
      return {
        async run(...args: unknown[]) {
          runCalls.push(args);
          return {
            records: [
              {
                get(key: string) {
                  assert.equal(key, "serverConfig");
                  return {
                    enableDownloads: true,
                    DefaultServerRole: { canCreateChannel: true, canManageRoles: "true", canManageAdmins: neo4j.int(1) },
                    DefaultSuspendedRole: null,
                    DefaultAdminRole: null,
                    DefaultSuperAdminRole: null,
                    DefaultModRole: null,
                    DefaultElevatedModRole: null,
                    DefaultSuspendedModRole: null,
                    SuperAdmins: [{ username: neo4j.int(1) }],
                    Admins: [{ username: null }],
                    Moderators: [{ displayName: "mod" }],
                    SuspendedUsers: [
                      {
                        id: "suspension-1",
                        RelatedIssue: { issueNumber: neo4j.int(42) },
                      },
                    ],
                    SuspendedMods: [],
                  };
                },
              },
            ],
          };
        },
        async close() {
          closeCalls += 1;
        },
      };
    },
  } as unknown as Driver;

  const repository = createPermissionServerConfigRepository(
    driver,
    "permissions-db"
  );
  const result = await repository.findByName("community");

  assert.deepEqual(sessionConfigs, [
    { database: "permissions-db", defaultAccessMode: neo4j.session.WRITE },
  ]);
  assert.deepEqual(runCalls, [
    [
      PERMISSION_SERVER_CONFIG_QUERY,
      { serverName: "community" },
    ],
  ]);
  assert.equal(closeCalls, 1);
  assert.equal(result?.DefaultServerRole?.canManageRoles, "true");
  assert.equal(result?.DefaultServerRole?.canManageAdmins, 1);
  assert.deepEqual(result?.SuperAdmins, [{ username: 1 }]);
  assert.deepEqual(result?.Admins, [{ username: null }]);
  assert.deepEqual(result?.Moderators, [{ displayName: "mod" }]);
  assert.equal(result?.SuspendedUsers[0]?.RelatedIssue?.issueNumber, 42);
});

test("findByName returns null when the server config is absent", async () => {
  const driver = {
    session() {
      return {
        async run() {
          return { records: [] };
        },
        async close() {},
      };
    },
  } as unknown as Driver;

  const repository = createPermissionServerConfigRepository(driver, "neo4j");

  assert.equal(await repository.findByName(undefined), null);
});

test("unvalidated server capability values cannot grant permissions or escalation rights", async () => {
  const { evaluateServerPermission } = await import("../../rules/permission/hasServerPermission.js");
  const { findEscalatedCapabilities } = await import("../../rules/validation/roleEscalation.js");
  for (const value of ["true", 1, [], {}, null, undefined, false]) {
    const role = { canManageRoles: value };
    for (const tier of ["default", "admin", "super-admin", "suspended"]) {
      assert.ok(evaluateServerPermission({
        permission: "canManageRoles",
        defaultServerRole: role,
        adminRole: role,
        superAdminRole: role,
        defaultSuspendedRole: role,
        isAdmin: tier === "admin",
        isSuperAdmin: tier === "super-admin",
        hasActiveSuspension: tier === "suspended",
      }) instanceof Error);
    }
    assert.deepEqual(findEscalatedCapabilities({
      requested: [{ canManageRoles: true }],
      capabilityFields: ["canManageRoles"],
      actorRole: role,
    }), ["canManageRoles"]);
  }
});
