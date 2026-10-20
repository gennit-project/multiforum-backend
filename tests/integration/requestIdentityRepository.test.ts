import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { Driver } from "neo4j-driver";
import { createRequestIdentityRepository } from "../../services/persistence/requestIdentityRepository.js";
import {
  resetDatabase,
  startNeo4j,
  stopNeo4j,
} from "./neo4jHarness.js";

let driver: Driver;

before(async () => {
  driver = await startNeo4j();
});

beforeEach(async () => {
  await resetDatabase(driver);
});

after(async () => {
  await stopNeo4j();
});

test("resolves request identity by username and email", async () => {
  await driver.executeQuery(`
    CREATE (email:Email {address: "alice@example.test"})
    CREATE (user:User {username: "alice", dateOfBirth: date("1991-04-05")})
    CREATE (profile:ModerationProfile {displayName: "Mod Alice"})
    CREATE (email)-[:HAS_EMAIL]->(user)
    CREATE (user)-[:MODERATION_PROFILE]->(profile)
  `);
  const repository = createRequestIdentityRepository(driver, "neo4j");
  const expected = {
    username: "alice",
    dateOfBirth: "1991-04-05",
    modProfileName: "Mod Alice",
  };

  assert.deepEqual(await repository.findByUsername("alice"), expected);
  assert.deepEqual(
    await repository.findByEmail("alice@example.test"),
    expected
  );
  assert.equal(await repository.userExists("alice"), true);
});

test("returns missing identity and existence states", async () => {
  const repository = createRequestIdentityRepository(driver, "neo4j");

  assert.equal(await repository.findByUsername("missing"), null);
  assert.equal(await repository.findByEmail("missing@example.test"), null);
  assert.equal(await repository.userExists("missing"), false);
});
