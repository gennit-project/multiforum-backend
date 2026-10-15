import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { Driver } from "neo4j-driver";
import { createSuspensionEffectsRepository } from "../../services/persistence/suspensionEffectsRepository.js";
import {
  resetDatabase,
  startNeo4j,
  stopNeo4j,
} from "./neo4jHarness.js";

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

test("disconnects only the targeted active suspension relationships", async () => {
  await driver.executeQuery(
    `CREATE (channel:Channel {uniqueName: 'gardening'})
     CREATE (server:ServerConfig {serverName: 'Community Forum'})
     CREATE (user:User {username: 'alice'})
     CREATE (profile:ModerationProfile {displayName: 'Mod Alice'})
     CREATE (channelUser:Suspension {id: 'channel-user'})
     CREATE (channelMod:Suspension {id: 'channel-mod'})
     CREATE (channelKept:Suspension {id: 'channel-kept'})
     CREATE (serverUser:Suspension {id: 'server-user'})
     CREATE (serverMod:Suspension {id: 'server-mod'})
     CREATE (serverKept:Suspension {id: 'server-kept'})
     CREATE (channel)-[:SUSPENDED_AS_USER]->(channelUser)
     CREATE (channel)-[:SUSPENDED_AS_MOD]->(channelMod)
     CREATE (channel)-[:SUSPENDED_AS_USER]->(channelKept)
     CREATE (server)-[:SUSPENDED_AS_USER]->(serverUser)
     CREATE (server)-[:SUSPENDED_AS_MOD]->(serverMod)
     CREATE (server)-[:SUSPENDED_AS_MOD]->(serverKept)
     CREATE (user)-[:SUSPENDED_AS_USER]->(channelUser)
     CREATE (user)-[:SUSPENDED_AS_USER]->(serverUser)
     CREATE (profile)-[:SUSPENDED_AS_MOD]->(channelMod)
     CREATE (profile)-[:SUSPENDED_AS_MOD]->(serverMod)`,
    {},
    { database: "neo4j" }
  );
  const repository = createSuspensionEffectsRepository(driver, "neo4j");

  await repository.disconnectExpiredChannelSuspensions({
    scopeName: "gardening",
    userSuspensionIds: ["channel-user", "server-user"],
    modSuspensionIds: ["channel-mod"],
  });
  await repository.disconnectExpiredServerSuspensions({
    scopeName: "Community Forum",
    userSuspensionIds: ["server-user"],
    modSuspensionIds: ["server-mod", "channel-mod"],
  });

  const result = await driver.executeQuery(
    `MATCH (channel:Channel {uniqueName: 'gardening'})
     MATCH (server:ServerConfig {serverName: 'Community Forum'})
     RETURN
       COUNT { (channel)-[:SUSPENDED_AS_USER|SUSPENDED_AS_MOD]->() } AS channelEdges,
       COUNT { (server)-[:SUSPENDED_AS_USER|SUSPENDED_AS_MOD]->() } AS serverEdges,
       COUNT { (:User)-[:SUSPENDED_AS_USER]->() } AS userAuditEdges,
       COUNT { (:ModerationProfile)-[:SUSPENDED_AS_MOD]->() } AS modAuditEdges,
       COUNT { (:Suspension) } AS suspensionNodes`,
    {},
    { database: "neo4j" }
  );
  const record = result.records[0];
  assert.equal(record?.get("channelEdges").toNumber(), 1);
  assert.equal(record?.get("serverEdges").toNumber(), 1);
  assert.equal(record?.get("userAuditEdges").toNumber(), 2);
  assert.equal(record?.get("modAuditEdges").toNumber(), 2);
  assert.equal(record?.get("suspensionNodes").toNumber(), 6);
});

test("creates, deduplicates, and honors suspension notification preferences", async () => {
  await driver.executeQuery(
    `CREATE (:User {username: 'alice'})
     CREATE (:User {username: 'bob', notifyOnSuspensionBlocks: false})`,
    {},
    { database: "neo4j" }
  );
  const repository = createSuspensionEffectsRepository(driver, "neo4j");
  const input = { username: "alice", text: "Suspended from posting." };

  assert.equal(await repository.createBlockNotification(input), "created");
  assert.equal(await repository.createBlockNotification(input), "duplicate");
  assert.equal(
    await repository.createBlockNotification({ ...input, username: "bob" }),
    "disabled"
  );
  assert.equal(
    await repository.createBlockNotification({ ...input, username: "missing" }),
    "user-not-found"
  );

  await driver.executeQuery(
    `MATCH (:User {username: 'alice'})-[:HAS_NOTIFICATION]->(notification:Notification)
     SET notification.read = true`,
    {},
    { database: "neo4j" }
  );
  assert.equal(await repository.createBlockNotification(input), "created");

  const result = await driver.executeQuery(
    `MATCH (:User {username: 'alice'})-[:HAS_NOTIFICATION]->(notification:Notification)
     RETURN count(notification) AS notificationCount,
            count(DISTINCT notification.id) AS distinctIds,
            count(notification.createdAt) AS timestamps`,
    {},
    { database: "neo4j" }
  );
  const record = result.records[0];
  assert.equal(record?.get("notificationCount").toNumber(), 2);
  assert.equal(record?.get("distinctIds").toNumber(), 2);
  assert.equal(record?.get("timestamps").toNumber(), 2);
});
