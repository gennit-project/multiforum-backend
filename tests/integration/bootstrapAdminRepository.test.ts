import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { Driver } from "neo4j-driver";
import { createBootstrapAdminRepository } from "../../services/persistence/bootstrapAdminRepository.js";
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

const input = {
  serverName: "Community Forum",
  email: "admin@example.test",
  username: "admin",
};

const repository = () => createBootstrapAdminRepository(driver, "neo4j");

test("creates the first identity, connects it, and is idempotent", async () => {
  await driver.executeQuery(
    "CREATE (:ServerConfig {serverName: $serverName})",
    { serverName: input.serverName }
  );

  assert.deepEqual(await repository().reconcile(input), {
    status: "created",
    username: "admin",
  });
  assert.deepEqual(await repository().reconcile(input), {
    status: "unchanged",
    username: "admin",
  });

  const verification = await driver.executeQuery(`
    MATCH (email:Email {address: $email})-[:HAS_EMAIL]->(user:User {username: $username})
    MATCH (user)-[:MODERATION_PROFILE]->(profile:ModerationProfile)
    MATCH (user)-[:SUPER_ADMIN_OF_SERVER]->(server:ServerConfig {serverName: $serverName})
    RETURN user.createdAt IS NOT NULL AS userTimestamped,
           user.notifyWhenTagged AS notifyWhenTagged,
           profile.displayName AS profileName,
           profile.createdAt IS NOT NULL AS profileTimestamped,
           count(*) AS matchingPaths
  `, input);
  const result = verification.records[0];
  assert.equal(result?.get("userTimestamped"), true);
  assert.equal(result?.get("notifyWhenTagged"), true);
  assert.equal(result?.get("profileName"), "bootstrap-admin");
  assert.equal(result?.get("profileTimestamped"), true);
  assert.equal(result?.get("matchingPaths").toNumber(), 1);
});

test("connects an existing matching identity", async () => {
  await driver.executeQuery(`
    CREATE (server:ServerConfig {serverName: $serverName})
    CREATE (user:User {username: $username})
    CREATE (email:Email {address: $email})-[:HAS_EMAIL]->(user)
  `, input);

  assert.deepEqual(await repository().reconcile(input), {
    status: "connected",
    username: "admin",
  });
  const verification = await driver.executeQuery(`
    MATCH (:User {username: $username})-[relationship:SUPER_ADMIN_OF_SERVER]->
          (:ServerConfig {serverName: $serverName})
    RETURN count(relationship) AS relationships
  `, input);
  assert.equal(verification.records[0]?.get("relationships").toNumber(), 1);
});

test("skips creation when another user already exists", async () => {
  await driver.executeQuery(`
    CREATE (:ServerConfig {serverName: $serverName})
    CREATE (:User {username: "someone-else"})
  `, input);

  assert.deepEqual(await repository().reconcile(input), {
    status: "skipped",
    reason: "database-not-empty",
  });
  const verification = await driver.executeQuery(
    "MATCH (user:User {username: $username}) RETURN count(user) AS users",
    input
  );
  assert.equal(verification.records[0]?.get("users").toNumber(), 0);
});

test("rejects collisions and incomplete identity relationships", async () => {
  await driver.executeQuery(`
    CREATE (user:User {username: $username})
    CREATE (:Email {address: "other@example.test"})-[:HAS_EMAIL]->(user)
  `, input);
  await assert.rejects(
    repository().reconcile(input),
    /username is linked to a different email/
  );

  await resetDatabase(driver);
  await driver.executeQuery(`
    CREATE (user:User {username: "someone-else"})
    CREATE (:Email {address: $email})-[:HAS_EMAIL]->(user)
  `, input);
  await assert.rejects(
    repository().reconcile(input),
    /admin@example\.test.*linked to a different username/
  );

  await resetDatabase(driver);
  await driver.executeQuery(`
    CREATE (:User {username: $username})
    CREATE (:Email {address: $email})
  `, input);
  await assert.rejects(
    repository().reconcile(input),
    /existing user\/email relationship is incomplete/
  );
});

test("rolls back a newly created identity when ServerConfig is missing", async () => {
  await assert.rejects(
    repository().reconcile(input),
    /ServerConfig 'Community Forum' does not exist/
  );

  const verification = await driver.executeQuery(`
    OPTIONAL MATCH (user:User {username: $username})
    OPTIONAL MATCH (email:Email {address: $email})
    OPTIONAL MATCH (profile:ModerationProfile {displayName: "bootstrap-admin"})
    RETURN user IS NOT NULL AS userExists,
           email IS NOT NULL AS emailExists,
           profile IS NOT NULL AS profileExists
  `, input);
  const result = verification.records[0];
  assert.equal(result?.get("userExists"), false);
  assert.equal(result?.get("emailExists"), false);
  assert.equal(result?.get("profileExists"), false);
});
