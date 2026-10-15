import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { Driver } from "neo4j-driver";
import {
  DEFAULT_MOD_SERVER_ROLES,
  DEFAULT_SERVER_ROLES,
  ROLE_NAMES,
} from "../../seedData/defaultRoles.js";
import { provisionServerDefaults } from "../../seedData/provisionServerDefaults.js";
import { createServerDefaultsRepository } from "../../services/persistence/serverDefaultsRepository.js";
import {
  resetDatabase,
  startNeo4j,
  stopNeo4j,
} from "./neo4jHarness.js";

const SERVER_CONFIG_NAME = "ProvisionTestServer";
let driver: Driver;

before(async () => {
  driver = await startNeo4j();
}, { timeout: 240000 });

beforeEach(async () => {
  await resetDatabase(driver);
});

after(async () => {
  await stopNeo4j();
});

const provision = () =>
  provisionServerDefaults({
    repository: createServerDefaultsRepository(driver, "neo4j"),
    serverName: SERVER_CONFIG_NAME,
  });

test("creates the canonical roles, config, and default-role links", async () => {
  const result = await provision();
  assert.equal(result.serverConfigCreated, true);
  assert.equal(result.serverRolesUpserted, DEFAULT_SERVER_ROLES.length);
  assert.equal(result.modServerRolesUpserted, DEFAULT_MOD_SERVER_ROLES.length);
  assert.equal(result.rolesWired.length, 7);

  const verification = await driver.executeQuery(
    `MATCH (config:ServerConfig {serverName: $serverName})
     MATCH (config)-[:HAS_DEFAULT_ADMIN_ROLE]->(admin:ServerRole {name: $adminName})
     MATCH (config)-[:HAS_DEFAULT_SUPER_ADMIN_ROLE]->(superAdmin:ServerRole {name: $superAdminName})
     MATCH (config)-[:HAS_DEFAULT_MOD_ROLE]->(moderator:ModServerRole {name: $moderatorName})
     RETURN admin.canManageAdmins AS adminCanManageAdmins,
            superAdmin.canManageAdmins AS superAdminCanManageAdmins,
            moderator.canReport AS moderatorCanReport`,
    {
      serverName: SERVER_CONFIG_NAME,
      adminName: ROLE_NAMES.administrator,
      superAdminName: ROLE_NAMES.superAdministrator,
      moderatorName: ROLE_NAMES.modBasic,
    },
    { database: "neo4j" }
  );
  const record = verification.records[0];
  assert.equal(record?.get("adminCanManageAdmins"), false);
  assert.equal(record?.get("superAdminCanManageAdmins"), true);
  assert.equal(record?.get("moderatorCanReport"), true);
});

test("corrects stale defaults while preserving unrelated data", async () => {
  await driver.executeQuery(
    `CREATE (config:ServerConfig {serverName: $serverName, customSetting: 'keep'})
     CREATE (legacy:ServerRole {name: 'Legacy Default Role'})
     CREATE (admin:ServerRole {name: $adminName, customProperty: 'keep'})
     CREATE (custom:ServerRole {name: 'Custom Role'})
     CREATE (config)-[:HAS_DEFAULT_SERVER_ROLE]->(legacy)
     CREATE (config)-[:USES_CUSTOM_ROLE]->(custom)`,
    { serverName: SERVER_CONFIG_NAME, adminName: ROLE_NAMES.administrator },
    { database: "neo4j" }
  );

  const result = await provision();
  assert.ok(result.rolesWired.includes("DefaultServerRole"));

  const verification = await driver.executeQuery(
    `MATCH (config:ServerConfig {serverName: $serverName})
     MATCH (config)-[:HAS_DEFAULT_SERVER_ROLE]->(defaultRole:ServerRole)
     MATCH (config)-[:USES_CUSTOM_ROLE]->(custom:ServerRole {name: 'Custom Role'})
     MATCH (admin:ServerRole {name: $adminName})
     RETURN config.customSetting AS customSetting,
            defaultRole.name AS defaultRoleName,
            custom.name AS customRoleName,
            admin.customProperty AS customProperty`,
    { serverName: SERVER_CONFIG_NAME, adminName: ROLE_NAMES.administrator },
    { database: "neo4j" }
  );
  const record = verification.records[0];
  assert.equal(record?.get("customSetting"), "keep");
  assert.equal(record?.get("defaultRoleName"), ROLE_NAMES.serverStandard);
  assert.equal(record?.get("customRoleName"), "Custom Role");
  assert.equal(record?.get("customProperty"), "keep");
});

test("backfills admins and is idempotent on a repeat run", async () => {
  await driver.executeQuery(
    `CREATE (config:ServerConfig {serverName: $serverName})
     CREATE (alice:User {username: 'alice'})-[:ADMIN_OF_SERVER]->(config)
     CREATE (bob:User {username: 'bob'})-[:ADMIN_OF_SERVER]->(config)
     CREATE (bob)-[:SUPER_ADMIN_OF_SERVER]->(config)`,
    { serverName: SERVER_CONFIG_NAME },
    { database: "neo4j" }
  );

  const first = await provision();
  assert.deepEqual(first.adminsBackfilledToSuperAdmins, ["alice"]);
  const second = await provision();
  assert.deepEqual(second.rolesWired, []);
  assert.deepEqual(second.adminsBackfilledToSuperAdmins, []);

  const verification = await driver.executeQuery(
    `MATCH (config:ServerConfig {serverName: $serverName})
     OPTIONAL MATCH (user:User)-[membership:SUPER_ADMIN_OF_SERVER]->(config)
     OPTIONAL MATCH (admin:ServerRole {name: $adminName})
     RETURN count(DISTINCT membership) AS memberships,
            count(DISTINCT admin) AS adminRoles`,
    { serverName: SERVER_CONFIG_NAME, adminName: ROLE_NAMES.administrator },
    { database: "neo4j" }
  );
  assert.equal(verification.records[0]?.get("memberships").toNumber(), 2);
  assert.equal(verification.records[0]?.get("adminRoles").toNumber(), 1);
});

test("rolls back every write when a required default role is missing", async () => {
  await assert.rejects(
    createServerDefaultsRepository(driver, "neo4j").reconcile({
      serverName: SERVER_CONFIG_NAME,
      serverRoles: [{ name: "Transient Role", canCreateComment: true }],
      modServerRoles: [],
      wiring: [
        { relationship: "DefaultAdminRole", roleName: "Missing Role" },
      ],
    }),
    /role 'Missing Role' does not exist/
  );

  const verification = await driver.executeQuery(
    `OPTIONAL MATCH (role:ServerRole {name: 'Transient Role'})
     OPTIONAL MATCH (config:ServerConfig {serverName: $serverName})
     RETURN role IS NOT NULL AS roleExists, config IS NOT NULL AS configExists`,
    { serverName: SERVER_CONFIG_NAME },
    { database: "neo4j" }
  );
  assert.equal(verification.records[0]?.get("roleExists"), false);
  assert.equal(verification.records[0]?.get("configExists"), false);
});
