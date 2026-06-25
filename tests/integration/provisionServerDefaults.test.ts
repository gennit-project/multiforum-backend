// Runs provisionServerDefaults against a real Neo4j (Testcontainers) — the
// provisioning code otherwise only has mock-based unit tests. Verifies that a
// fresh provision creates the default roles, wires the ServerConfig tier links,
// and backfills existing Admins into SuperAdmins, and that re-running is
// idempotent. See seedData/ and docs/isadmin-phaseout-design.md.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import type { Driver } from "neo4j-driver";
import { Neo4jContainer, StartedNeo4jContainer } from "@testcontainers/neo4j";
import { ROLE_NAMES } from "../../seedData/defaultRoles.js";

const SERVER_CONFIG_NAME = "ProvisionTestServer";

let container: StartedNeo4jContainer;
let driver: Driver;
let ogm: any;
let provisionServerDefaults: any;

const provision = () =>
  provisionServerDefaults({
    ServerRole: ogm.model("ServerRole"),
    ModServerRole: ogm.model("ModServerRole"),
    ServerConfig: ogm.model("ServerConfig"),
    serverName: SERVER_CONFIG_NAME,
  });

before(async () => {
  container = await new Neo4jContainer("neo4j:5-community").withApoc().start();
  process.env.NEO4J_URI = container.getBoltUri();
  process.env.NEO4J_USER = container.getUsername();
  process.env.NEO4J_PASSWORD = container.getPassword();
  process.env.SERVER_CONFIG_NAME = SERVER_CONFIG_NAME;

  const { buildPermissionedSchema } = await import(
    "../helpers/buildPermissionedSchema.js"
  );
  ({ driver, ogm } = await buildPermissionedSchema());
  await ogm.init();
  ({ provisionServerDefaults } = await import(
    "../../seedData/provisionServerDefaults.js"
  ));

  // Seed a ServerConfig with two existing admins to exercise the backfill.
  const session = driver.session();
  try {
    await session.run(
      `CREATE (sc:ServerConfig { serverName: $name })
       CREATE (a:User { username: 'alice' })-[:ADMIN_OF_SERVER]->(sc)
       CREATE (b:User { username: 'bob' })-[:ADMIN_OF_SERVER]->(sc)`,
      { name: SERVER_CONFIG_NAME }
    );
  } finally {
    await session.close();
  }
}, { timeout: 240000 });

after(async () => {
  await driver?.close();
  await container?.stop();
});

const findRole = async (name: string) => {
  const roles = await ogm.model("ServerRole").find({
    where: { name },
    selectionSet: `{ name canManageAdmins canManageSuperAdmins canManageServerSettings }`,
  });
  return roles[0];
};

test("fresh provisioning creates the default roles with the restricted/super split", async () => {
  const result = await provision();
  assert.equal(result.serverConfigCreated, false, "config already existed");

  const admin = await findRole(ROLE_NAMES.administrator);
  const superAdmin = await findRole(ROLE_NAMES.superAdministrator);
  assert.equal(admin.canManageServerSettings, true);
  assert.equal(admin.canManageAdmins, false, "restricted admin cannot manage admins");
  assert.equal(superAdmin.canManageAdmins, true, "super admin can");
});

test("the ServerConfig tier role links are wired", async () => {
  const configs = await ogm.model("ServerConfig").find({
    where: { serverName: SERVER_CONFIG_NAME },
    selectionSet: `{
      DefaultAdminRole { name }
      DefaultSuperAdminRole { name }
      DefaultServerRole { name }
    }`,
  });
  const sc = configs[0];
  assert.equal(sc.DefaultAdminRole?.name, ROLE_NAMES.administrator);
  assert.equal(sc.DefaultSuperAdminRole?.name, ROLE_NAMES.superAdministrator);
  assert.equal(sc.DefaultServerRole?.name, ROLE_NAMES.serverStandard);
});

test("existing admins are backfilled into SuperAdmins", async () => {
  const configs = await ogm.model("ServerConfig").find({
    where: { serverName: SERVER_CONFIG_NAME },
    selectionSet: `{ SuperAdmins { username } }`,
  });
  const superAdmins = (configs[0].SuperAdmins ?? [])
    .map((u: { username: string }) => u.username)
    .sort();
  assert.deepEqual(superAdmins, ["alice", "bob"]);
});

test("re-running is idempotent (no duplicate roles, backfill no-op)", async () => {
  const result = await provision();
  assert.deepEqual(result.adminsBackfilledToSuperAdmins, [], "already super-admins");

  // Exactly one Administrator role exists (upsert, not duplicate-create).
  const admins = await ogm.model("ServerRole").find({
    where: { name: ROLE_NAMES.administrator },
    selectionSet: `{ name }`,
  });
  assert.equal(admins.length, 1);
});
