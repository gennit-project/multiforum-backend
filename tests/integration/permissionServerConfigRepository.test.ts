import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { Driver } from "neo4j-driver";
import { createPermissionServerConfigRepository } from "../../services/persistence/permissionServerConfigRepository.js";
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

test("projects the authorization data expected by permission rules", async () => {
  await driver.executeQuery(`
    CREATE (server:ServerConfig {
      serverName: "community",
      enableDownloads: true
    })
    CREATE (defaultRole:ServerRole {
      name: "default",
      canCreateChannel: true,
      canUploadFile: false
    })
    CREATE (suspendedModRole:ModServerRole {
      name: "suspended-mod",
      canSuspendUser: false,
      canReport: true
    })
    CREATE (admin:User {username: "alice"})
    CREATE (moderator:ModerationProfile {displayName: "Mod Alice"})
    CREATE (suspension:Suspension {
      id: "suspension-1",
      username: "bob",
      serverName: "community",
      suspendedUntil: datetime("2030-01-02T03:04:05Z"),
      suspendedIndefinitely: false
    })
    CREATE (issue:Issue {id: "issue-1", issueNumber: 42})
    CREATE (server)-[:HAS_DEFAULT_SERVER_ROLE]->(defaultRole)
    CREATE (server)-[:HAS_DEFAULT_SUSPENDED_ROLE]->(suspendedModRole)
    CREATE (admin)-[:ADMIN_OF_SERVER]->(server)
    CREATE (moderator)-[:MODERATOR_OF_SERVER]->(server)
    CREATE (server)-[:SUSPENDED_AS_USER]->(suspension)
    CREATE (suspension)-[:HAS_CONTEXT]->(issue)
  `);

  const repository = createPermissionServerConfigRepository(driver, "neo4j");
  const result = await repository.findByName("community");

  assert.equal(result?.enableDownloads, true);
  assert.equal(result?.DefaultServerRole?.canCreateChannel, true);
  assert.equal(result?.DefaultServerRole?.canUploadFile, false);
  assert.equal(result?.DefaultSuspendedModRole?.canSuspendUser, false);
  assert.deepEqual(result?.Admins, [{ username: "alice" }]);
  assert.deepEqual(result?.Moderators, [{ displayName: "Mod Alice" }]);
  assert.deepEqual(result?.SuspendedUsers, [
    {
      id: "suspension-1",
      username: "bob",
      modProfileName: null,
      serverName: "community",
      suspendedUntil: "2030-01-02T03:04:05Z",
      suspendedIndefinitely: false,
      RelatedIssue: { id: "issue-1", issueNumber: 42 },
    },
  ]);
});

test("returns null for an unknown server config", async () => {
  const repository = createPermissionServerConfigRepository(driver, "neo4j");

  assert.equal(await repository.findByName("missing"), null);
});
