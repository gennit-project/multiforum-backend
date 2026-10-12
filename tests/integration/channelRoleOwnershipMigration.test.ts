import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import {
  Neo4jContainer,
  type StartedNeo4jContainer,
} from "@testcontainers/neo4j";
import neo4j, { type Driver } from "neo4j-driver";
import {
  auditChannelRoleOwnership,
  migrateChannelRoleOwnership,
} from "../../services/channelRoleOwnershipMigration.js";

let container: StartedNeo4jContainer;
let driver: Driver;

before(async () => {
  container = await new Neo4jContainer("neo4j:5-community").start();
  driver = neo4j.driver(
    container.getBoltUri(),
    neo4j.auth.basic(container.getUsername(), container.getPassword())
  );
  await driver.getServerInfo();
}, { timeout: 240_000 });

after(async () => {
  await driver?.close();
  await container?.stop();
});

const run = async (query: string) => {
  const session = driver.session();
  try {
    return await session.run(query);
  } finally {
    await session.close();
  }
};

test("migration backfills explicit owners and removes global name constraints", async () => {
  await run(`
    CREATE CONSTRAINT legacy_channel_role_name IF NOT EXISTS
      FOR (role:ChannelRole) REQUIRE role.name IS UNIQUE
  `);
  await run(`
    CREATE CONSTRAINT legacy_mod_channel_role_name IF NOT EXISTS
      FOR (role:ModChannelRole) REQUIRE role.name IS UNIQUE
  `);
  await run(`
    CREATE (cats:Channel {uniqueName: 'cats'})
    CREATE (dogs:Channel {uniqueName: 'dogs'})
    CREATE (reader:ChannelRole {name: 'Reader'})
    CREATE (moderator:ModChannelRole {name: 'Moderator', channelUniqueName: 'dogs'})
    CREATE (cats)-[:HAS_DEFAULT_CHANNEL_ROLE]->(reader)
    CREATE (dogs)-[:HAS_DEFAULT_MOD_ROLE]->(moderator)
  `);

  const audit = await auditChannelRoleOwnership(driver);
  assert.equal(audit.records.length, 2);
  assert.deepEqual(audit.legacyGlobalNameConstraints.sort(), [
    "legacy_channel_role_name",
    "legacy_mod_channel_role_name",
  ]);

  const result = await migrateChannelRoleOwnership(driver);
  assert.equal(result.linkedChannelRoles, 1);
  assert.equal(result.linkedModChannelRoles, 1);
  assert.equal(result.droppedLegacyConstraints, 2);

  const roles = await run(`
    MATCH (channel:Channel)-[owner]->(role)
    WHERE type(owner) IN ['OWNS_CHANNEL_ROLE', 'OWNS_MOD_CHANNEL_ROLE']
    RETURN labels(role)[0] AS kind, role.name AS name, role.id AS id,
           role.channelUniqueName AS channelUniqueName,
           channel.uniqueName AS owner
    ORDER BY kind
  `);
  assert.deepEqual(roles.records.map((record) => ({
    kind: record.get("kind"),
    name: record.get("name"),
    hasId: typeof record.get("id") === "string",
    channelUniqueName: record.get("channelUniqueName"),
    owner: record.get("owner"),
  })), [
    {
      kind: "ChannelRole",
      name: "Reader",
      hasId: true,
      channelUniqueName: "cats",
      owner: "cats",
    },
    {
      kind: "ModChannelRole",
      name: "Moderator",
      hasId: true,
      channelUniqueName: "dogs",
      owner: "dogs",
    },
  ]);

  const constraints = await run(`
    SHOW CONSTRAINTS YIELD name
    WHERE name STARTS WITH 'legacy_'
    RETURN name
  `);
  assert.equal(constraints.records.length, 0);
});
