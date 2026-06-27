import assert from "node:assert/strict";
import test from "node:test";
import {
  provisionServerDefaults,
  provisionServerDefaultsFromOgm,
} from "./provisionServerDefaults.js";
import {
  DEFAULT_SERVER_ROLES,
  DEFAULT_MOD_SERVER_ROLES,
  ROLE_NAMES,
} from "./defaultRoles.js";

// Minimal recording model. `existing` decides whether find() reports the role
// as already present (drives the upsert branch).
const makeRoleModel = (existing: boolean) => {
  const calls = { create: [] as any[], update: [] as any[], find: 0 };
  return {
    calls,
    model: {
      find: async () => {
        calls.find += 1;
        return existing ? [{ name: "x" }] : [];
      },
      create: async (args: any) => {
        calls.create.push(args);
        return {};
      },
      update: async (args: any) => {
        calls.update.push(args);
        return {};
      },
    },
  };
};

const makeServerConfigModel = (
  config: { Admins?: any[]; SuperAdmins?: any[] } | null
) => {
  const calls = { create: [] as any[], update: [] as any[] };
  return {
    calls,
    model: {
      find: async () => (config ? [config] : []),
      create: async (args: any) => {
        calls.create.push(args);
        return {};
      },
      update: async (args: any) => {
        calls.update.push(args);
        return {};
      },
    },
  };
};

test("the seeded admin roles encode the restricted-vs-super distinction", () => {
  const admin = DEFAULT_SERVER_ROLES.find((r) => r.name === ROLE_NAMES.administrator)!;
  const superAdmin = DEFAULT_SERVER_ROLES.find(
    (r) => r.name === ROLE_NAMES.superAdministrator
  )!;

  // Restricted admin is permissive but cannot make admins.
  assert.equal(admin.canManageServerSettings, true);
  assert.equal(admin.canManagePlugins, true);
  assert.equal(admin.canManageAdmins, false);
  assert.equal(admin.canManageSuperAdmins, false);

  // Super admin can.
  assert.equal(superAdmin.canManageAdmins, true);
  assert.equal(superAdmin.canManageSuperAdmins, true);
});

test("the elevated mod role grants the destructive structural caps", () => {
  const elevated = DEFAULT_MOD_SERVER_ROLES.find(
    (r) => r.name === ROLE_NAMES.modElevated
  )!;
  assert.equal(elevated.canRemoveDiscussionChannel, true);
  assert.equal(elevated.canRemoveEventChannel, true);
});

test("fresh provisioning creates roles and the server config", async () => {
  const ServerRole = makeRoleModel(false);
  const ModServerRole = makeRoleModel(false);
  const ServerConfig = makeServerConfigModel(null);

  const result = await provisionServerDefaults({
    ServerRole: ServerRole.model as any,
    ModServerRole: ModServerRole.model as any,
    ServerConfig: ServerConfig.model as any,
    serverName: "Test Server",
  });

  assert.equal(ServerRole.calls.create.length, DEFAULT_SERVER_ROLES.length);
  assert.equal(ServerRole.calls.update.length, 0);
  assert.equal(ModServerRole.calls.create.length, DEFAULT_MOD_SERVER_ROLES.length);
  assert.equal(result.serverConfigCreated, true);
  // The config is created, then updated to wire the default-role links.
  assert.equal(ServerConfig.calls.create.length, 1);
  assert.ok(result.rolesWired.includes("DefaultSuperAdminRole"));
  assert.ok(result.rolesWired.includes("DefaultAdminRole"));
});

test("re-running provisioning updates existing roles (idempotent upsert)", async () => {
  const ServerRole = makeRoleModel(true);
  const ModServerRole = makeRoleModel(true);
  const ServerConfig = makeServerConfigModel({ Admins: [], SuperAdmins: [] });

  const result = await provisionServerDefaults({
    ServerRole: ServerRole.model as any,
    ModServerRole: ModServerRole.model as any,
    ServerConfig: ServerConfig.model as any,
    serverName: "Test Server",
  });

  assert.equal(ServerRole.calls.create.length, 0);
  assert.equal(ServerRole.calls.update.length, DEFAULT_SERVER_ROLES.length);
  assert.equal(result.serverConfigCreated, false);
});

test("backfill promotes only admins that are not already super-admins", async () => {
  const ServerRole = makeRoleModel(true);
  const ModServerRole = makeRoleModel(true);
  const ServerConfig = makeServerConfigModel({
    Admins: [{ username: "alice" }, { username: "bob" }],
    SuperAdmins: [{ username: "bob" }],
  });

  const result = await provisionServerDefaults({
    ServerRole: ServerRole.model as any,
    ModServerRole: ModServerRole.model as any,
    ServerConfig: ServerConfig.model as any,
    serverName: "Test Server",
  });

  assert.deepEqual(result.adminsBackfilledToSuperAdmins, ["alice"]);
  // One update wires roles; a second update performs the backfill.
  const backfillUpdate = ServerConfig.calls.update.find(
    (u) => u.update?.SuperAdmins
  );
  assert.ok(backfillUpdate, "expected a SuperAdmins backfill update");
});

test("provisionServerDefaultsFromOgm resolves the three models off the OGM and delegates", async () => {
  const ServerRole = makeRoleModel(false);
  const ModServerRole = makeRoleModel(false);
  const ServerConfig = makeServerConfigModel(null);
  const requested: string[] = [];
  const ogm = {
    model: (name: string) => {
      requested.push(name);
      const byName: Record<string, unknown> = {
        ServerRole: ServerRole.model,
        ModServerRole: ModServerRole.model,
        ServerConfig: ServerConfig.model,
      };
      return byName[name];
    },
  };

  const result = await provisionServerDefaultsFromOgm(ogm, {
    serverName: "Test Server",
  });

  // It pulled exactly the three role/config models from the OGM...
  assert.deepEqual(requested.sort(), [
    "ModServerRole",
    "ServerConfig",
    "ServerRole",
  ]);
  // ...and the underlying provisioning ran against them.
  assert.equal(ServerRole.calls.create.length, DEFAULT_SERVER_ROLES.length);
  assert.equal(result.serverConfigCreated, true);
});

test("backfill is a no-op when all admins are already super-admins", async () => {
  const ServerRole = makeRoleModel(true);
  const ModServerRole = makeRoleModel(true);
  const ServerConfig = makeServerConfigModel({
    Admins: [{ username: "bob" }],
    SuperAdmins: [{ username: "bob" }],
  });

  const result = await provisionServerDefaults({
    ServerRole: ServerRole.model as any,
    ModServerRole: ModServerRole.model as any,
    ServerConfig: ServerConfig.model as any,
    serverName: "Test Server",
  });

  assert.deepEqual(result.adminsBackfilledToSuperAdmins, []);
  const backfillUpdate = ServerConfig.calls.update.find(
    (u) => u.update?.SuperAdmins
  );
  assert.equal(backfillUpdate, undefined);
});
