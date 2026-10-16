import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { Driver } from "neo4j-driver";
import { createChannelPermissionRepository } from "../../services/persistence/channelPermissionRepository.js";
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

test("projects channel authorization roles, owners, moderators, and lock state", async () => {
  await driver.executeQuery(`
    CREATE (channel:Channel {uniqueName: "cats", locked: true})
    CREATE (admin:User {username: "alice"})
    CREATE (moderator:ModerationProfile {displayName: "Mod A"})
    CREATE (defaultRole:ChannelRole {canCreateComment: true})
    CREATE (elevatedRole:ChannelRole {canUpdateChannel: false})
    CREATE (suspendedRole:ChannelRole {canCreateComment: false})
    CREATE (defaultModRole:ModChannelRole {canReport: true})
    CREATE (elevatedModRole:ModChannelRole {canSuspendUser: true})
    CREATE (suspendedModRole:ModChannelRole {canReport: false})
    CREATE (admin)-[:ADMIN_OF_CHANNEL]->(channel)
    CREATE (moderator)-[:MODERATOR_OF_CHANNEL]->(channel)
    CREATE (channel)-[:HAS_DEFAULT_CHANNEL_ROLE]->(defaultRole)
    CREATE (channel)-[:HAS_DEFAULT_ELEVATED_CHANNEL_ROLE]->(elevatedRole)
    CREATE (channel)-[:HAS_DEFAULT_SUSPENDED_ROLE]->(suspendedRole)
    CREATE (channel)-[:HAS_DEFAULT_MOD_ROLE]->(defaultModRole)
    CREATE (channel)-[:HAS_DEFAULT_ELEVATED_MOD_ROLE]->(elevatedModRole)
    CREATE (channel)-[:HAS_DEFAULT_SUSPENDED_ROLE]->(suspendedModRole)
  `);
  const repository = createChannelPermissionRepository(driver, "neo4j");

  const snapshot = await repository.findAuthorizationSnapshot("cats");

  assert.equal(snapshot?.locked, true);
  assert.deepEqual(snapshot?.Admins, [{ username: "alice" }]);
  assert.deepEqual(snapshot?.Moderators, [{ displayName: "Mod A" }]);
  assert.equal(snapshot?.DefaultChannelRole?.canCreateComment, true);
  assert.equal(snapshot?.ElevatedChannelRole?.canUpdateChannel, false);
  assert.equal(snapshot?.SuspendedRole?.canCreateComment, false);
  assert.equal(snapshot?.DefaultModRole?.canReport, true);
  assert.equal(snapshot?.ElevatedModRole?.canSuspendUser, true);
  assert.equal(snapshot?.SuspendedModRole?.canReport, false);
  assert.equal(await repository.findAuthorizationSnapshot("missing"), null);
});

test("returns only suspensions for the requested user and moderator", async () => {
  await driver.executeQuery(`
    CREATE (channel:Channel {uniqueName: "cats"})
    CREATE (alice:User {username: "alice"})
    CREATE (bob:User {username: "bob"})
    CREATE (moderator:ModerationProfile {displayName: "Mod A"})
    CREATE (otherModerator:ModerationProfile {displayName: "Mod B"})
    CREATE (issue:Issue {id: "issue-1", issueNumber: 42})
    CREATE (userSuspension:Suspension {
      id: "user-suspension",
      suspendedUntil: datetime("2099-01-01T00:00:00Z"),
      suspendedIndefinitely: false
    })
    CREATE (otherUserSuspension:Suspension {id: "other-user-suspension"})
    CREATE (modSuspension:Suspension {
      id: "mod-suspension",
      modProfileName: "Mod A",
      suspendedIndefinitely: true
    })
    CREATE (otherModSuspension:Suspension {id: "other-mod-suspension"})
    CREATE (channel)-[:SUSPENDED_AS_USER]->(userSuspension)
    CREATE (channel)-[:SUSPENDED_AS_USER]->(otherUserSuspension)
    CREATE (alice)-[:SUSPENDED_AS_USER]->(userSuspension)
    CREATE (bob)-[:SUSPENDED_AS_USER]->(otherUserSuspension)
    CREATE (channel)-[:SUSPENDED_AS_MOD]->(modSuspension)
    CREATE (channel)-[:SUSPENDED_AS_MOD]->(otherModSuspension)
    CREATE (moderator)-[:SUSPENDED_AS_MOD]->(modSuspension)
    CREATE (otherModerator)-[:SUSPENDED_AS_MOD]->(otherModSuspension)
    CREATE (userSuspension)-[:HAS_CONTEXT]->(issue)
  `);
  const repository = createChannelPermissionRepository(driver, "neo4j");

  const result = await repository.findTargetedSuspensions({
    channelUniqueName: "cats",
    username: "alice",
    modProfileName: "Mod A",
  });

  assert.deepEqual(
    result.userSuspensions.map(({ id }) => id),
    ["user-suspension"]
  );
  assert.equal(result.userSuspensions[0]?.RelatedIssue?.issueNumber, 42);
  assert.match(result.userSuspensions[0]?.suspendedUntil ?? "", /^2099-01-01/);
  assert.deepEqual(
    result.modSuspensions.map(({ id }) => id),
    ["mod-suspension"]
  );
});
