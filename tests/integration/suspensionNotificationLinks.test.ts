// Integration tests for the suspension-block notification's issue link against
// live Neo4j.
//
// Both getActiveSuspension and suspensionNotification have unit tests, but those
// mock the driver — so the chain that makes the link "valid" is never exercised
// against a real graph: (a) resolving the related issue's number from the
// suspension's (:Suspension)-[:HAS_CONTEXT]->(:Issue) edge, and (b) persisting a
// notification whose markdown link points at that real issue. These tests drive
// the two real DB-touching layers, using a suspension created by the actual
// suspendUser resolver.
//
// Channel scope only: getActiveSuspension takes ogm/driver directly, whereas the
// server-scoped path depends on a cached ServerConfig + SERVER_CONFIG_NAME that
// is awkward to seed reliably here. The server link format (/admin/issues/N) is
// covered by the suspensionNotification unit tests.

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  startImageModEnv,
  stopImageModEnv,
  resetDb,
  run,
  seedModerator,
  mockToken,
  modContext,
  type ImageModEnv,
} from "./imageModerationHarness.js";
import { getActiveSuspension } from "../../rules/permission/getActiveSuspension.js";
import { createSuspensionNotification } from "../../rules/permission/suspensionNotification.js";

let env: ImageModEnv;

before(async () => {
  env = await startImageModEnv();
}, { timeout: 240000 });

after(async () => {
  await stopImageModEnv();
});

beforeEach(async () => {
  await resetDb();
  await seedModerator({ username: "mod1", modDisplayName: "Mod One" });
  // A channel-scoped Issue targeting "baduser", and the channel that owns it.
  await run(
    `CREATE (ch:Channel { uniqueName: 'test-channel', displayName: 'Test Channel', createdAt: datetime() })
     CREATE (target:User { username: 'baduser', displayName: 'Bad User', createdAt: datetime() })
     CREATE (i:Issue {
        id: 'issue-1', issueNumber: 1, isOpen: true,
        channelUniqueName: 'test-channel', relatedUsername: 'baduser',
        title: 'Report against baduser', authorName: 'Mod One', createdAt: datetime()
     })
     CREATE (ch)-[:HAS_ISSUE]->(i)`
  );
  // Create a real, indefinite suspension for baduser tied to issue-1 via the
  // actual resolver, so the suspension graph (including its issue context) is
  // shaped exactly as production builds it.
  await env.resolvers.Mutation.suspendUser(
    null,
    {
      issueId: "issue-1",
      suspendIndefinitely: true,
      explanation: "Repeated rule violations",
    },
    modContext(env, mockToken({ username: "mod1", email: "mod1@e2e.test" }))
  );
});

const notificationsFor = (username: string) =>
  run(
    `MATCH (:User { username: $username })-[:HAS_NOTIFICATION]->(n:Notification)
     RETURN n.text AS text`,
    { username }
  );

const userModel = () => env.ogm.model("User");

test("getActiveSuspension resolves the related issue number from the suspension graph", async () => {
  const info = await getActiveSuspension({
    ogm: env.ogm,
    driver: env.driver,
    channelUniqueName: "test-channel",
    username: "baduser",
  });

  assert.equal(info.isSuspended, true);
  assert.equal(info.relatedIssueNumber, 1);
});

test("the suspension block notification links to the related issue with a valid URL", async () => {
  const info = await getActiveSuspension({
    ogm: env.ogm,
    driver: env.driver,
    channelUniqueName: "test-channel",
    username: "baduser",
  });

  await createSuspensionNotification({
    UserModel: userModel(),
    username: "baduser",
    scopeName: "test-channel",
    scopeType: "channel",
    permission: "canCreateDiscussion",
    relatedIssueId: info.relatedIssueId,
    relatedIssueNumber: info.relatedIssueNumber,
    suspendedUntil: info.activeSuspension?.suspendedUntil || null,
    suspendedIndefinitely:
      info.activeSuspension?.suspendedIndefinitely || null,
    actorType: "user",
  });

  const notes = await notificationsFor("baduser");
  assert.equal(notes.length, 1);
  // The link uses the real issue number resolved from the suspension graph.
  assert.match(
    notes[0].text,
    /\[Issue #1\]\(\/forums\/test-channel\/issues\/1\)/
  );
});

test("no suspension block notification is created when the user has opted out", async () => {
  await run(
    `MATCH (u:User { username: 'baduser' }) SET u.notifyOnSuspensionBlocks = false`
  );

  await createSuspensionNotification({
    UserModel: userModel(),
    username: "baduser",
    scopeName: "test-channel",
    scopeType: "channel",
    permission: "canCreateDiscussion",
    relatedIssueId: "issue-1",
    relatedIssueNumber: 1,
    suspendedUntil: null,
    suspendedIndefinitely: true,
    actorType: "user",
  });

  const notes = await notificationsFor("baduser");
  assert.equal(notes.length, 0);
});
