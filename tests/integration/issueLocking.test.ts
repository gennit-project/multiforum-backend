// Integration tests for lockIssue / unlockIssue against live Neo4j.

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
  await run(
    // createdAt is non-nullable (@timestamp on CREATE); raw-Cypher seeding skips
    // it, so set it explicitly or the OGM update re-validation fails.
    `CREATE (:Issue {
        id: 'issue-1', issueNumber: 1, isOpen: true, locked: false,
        channelUniqueName: 'test-channel', title: 'Test issue', authorName: 'Mod One',
        createdAt: datetime()
     })`
  );
});

const ctx = () => modContext(env, mockToken({ username: "mod1", email: "mod1@e2e.test" }));

const lockIssue = (args: Record<string, unknown> = {}) =>
  env.resolvers.Mutation.lockIssue(
    null,
    { issueId: "issue-1", reason: "Off-topic flame war", ...args },
    ctx()
  );

const unlockIssue = (args: Record<string, unknown> = {}) =>
  env.resolvers.Mutation.unlockIssue(
    null,
    { issueId: "issue-1", reason: "Cooled down", ...args },
    ctx()
  );

test("lockIssue sets locked + reason and records a lock action", async () => {
  await lockIssue();

  const issue = await run(
    `MATCH (i:Issue { id: 'issue-1' })
     RETURN i.locked AS locked, i.lockReason AS reason, i.lockedAt AS at`
  );
  assert.equal(issue[0].locked, true);
  assert.equal(issue[0].reason, "Off-topic flame war");
  assert.ok(issue[0].at, "lockedAt should be set");

  const actions = await run(
    `MATCH (i:Issue { id: 'issue-1' })-[:ACTIVITY_ON_ISSUE]->(a:ModerationAction)
     RETURN collect(a.actionType) AS types`
  );
  assert.ok((actions[0].types as string[]).includes("lock"), `got ${JSON.stringify(actions[0]?.types)}`);
});

test("lockIssue throws when already locked", async () => {
  await lockIssue();
  await assert.rejects(lockIssue(), /already locked/i);
});

test("lockIssue throws when no reason is given", async () => {
  await assert.rejects(lockIssue({ reason: "" }), /reason is required/i);
});

test("unlockIssue clears the locked state after a lock", async () => {
  await lockIssue();
  await unlockIssue();

  const issue = await run(
    `MATCH (i:Issue { id: 'issue-1' }) RETURN i.locked AS locked, i.lockReason AS reason`
  );
  assert.equal(issue[0].locked, false);
  assert.equal(issue[0].reason, null);
});

test("unlockIssue throws when the issue is not locked", async () => {
  await assert.rejects(unlockIssue(), /not locked/i);
});

test("lockIssue throws when the issue does not exist", async () => {
  await assert.rejects(lockIssue({ issueId: "ghost" }), /Issue not found/i);
});
