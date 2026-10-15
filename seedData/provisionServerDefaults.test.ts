import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_MOD_SERVER_ROLES,
  DEFAULT_SERVER_ROLES,
  ROLE_NAMES,
  SERVER_CONFIG_ROLE_WIRING,
} from "./defaultRoles.js";
import { provisionServerDefaults } from "./provisionServerDefaults.js";
import type {
  ServerDefaultsRepository,
  ServerDefaultsResult,
} from "../services/persistence/serverDefaultsRepository.js";

test("the seeded admin roles encode the restricted-vs-super distinction", () => {
  const admin = DEFAULT_SERVER_ROLES.find(
    (role) => role.name === ROLE_NAMES.administrator
  )!;
  const superAdmin = DEFAULT_SERVER_ROLES.find(
    (role) => role.name === ROLE_NAMES.superAdministrator
  )!;

  assert.equal(admin.canManageServerSettings, true);
  assert.equal(admin.canManagePlugins, true);
  assert.equal(admin.canManageAdmins, false);
  assert.equal(admin.canManageSuperAdmins, false);
  assert.equal(superAdmin.canManageAdmins, true);
  assert.equal(superAdmin.canManageSuperAdmins, true);
});

test("the elevated mod role grants the destructive structural caps", () => {
  const elevated = DEFAULT_MOD_SERVER_ROLES.find(
    (role) => role.name === ROLE_NAMES.modElevated
  )!;
  assert.equal(elevated.canRemoveDiscussionChannel, true);
  assert.equal(elevated.canRemoveEventChannel, true);
});

const result: ServerDefaultsResult = {
  serverRolesUpserted: DEFAULT_SERVER_ROLES.length,
  modServerRolesUpserted: DEFAULT_MOD_SERVER_ROLES.length,
  serverConfigCreated: true,
  rolesWired: ["DefaultServerRole", "DefaultAdminRole"],
  adminsBackfilledToSuperAdmins: ["alice"],
};

test("delegates the canonical defaults and logs only after reconciliation", async () => {
  const calls: unknown[] = [];
  const messages: string[] = [];
  const repository: ServerDefaultsRepository = {
    async reconcile(input) {
      calls.push(input);
      assert.deepEqual(messages, []);
      return result;
    },
  };

  assert.deepEqual(
    await provisionServerDefaults({
      repository,
      serverName: "Test Server",
      log: (message) => messages.push(message),
    }),
    result
  );
  assert.deepEqual(calls, [
    {
      serverName: "Test Server",
      serverRoles: DEFAULT_SERVER_ROLES,
      modServerRoles: DEFAULT_MOD_SERVER_ROLES,
      wiring: Object.entries(SERVER_CONFIG_ROLE_WIRING).map(
        ([relationship, roleName]) => ({ relationship, roleName })
      ),
    },
  ]);
  assert.deepEqual(messages, [
    "Upserted 4 server roles and 3 mod server roles.",
    "Created ServerConfig 'Test Server'.",
    "Wired 2 default-role links on 'Test Server'.",
    "Backfilled 1 admin(s) into SuperAdmins: alice.",
  ]);
});

test("omits create and backfill messages for an unchanged configuration", async () => {
  const messages: string[] = [];
  await provisionServerDefaults({
    repository: {
      async reconcile() {
        return {
          ...result,
          serverConfigCreated: false,
          rolesWired: [],
          adminsBackfilledToSuperAdmins: [],
        };
      },
    },
    serverName: "Test Server",
    log: (message) => messages.push(message),
  });

  assert.deepEqual(messages, [
    "Upserted 4 server roles and 3 mod server roles.",
    "Wired 0 default-role links on 'Test Server'.",
  ]);
});

test("does not log when reconciliation fails", async () => {
  const messages: string[] = [];
  await assert.rejects(
    provisionServerDefaults({
      repository: {
        async reconcile() {
          throw new Error("transaction rolled back");
        },
      },
      serverName: "Test Server",
      log: (message) => messages.push(message),
    }),
    /transaction rolled back/
  );
  assert.deepEqual(messages, []);
});
