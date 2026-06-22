// Integration tests for the shared suspension resolvers against live Neo4j:
// suspendUser + unsuspendUser (createSuspensionResolver / createUnsuspendResolver).

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
  // A channel-scoped Issue (Channel -[:HAS_ISSUE]-> Issue makes scope 'channel')
  // targeting user "baduser" via relatedUsername.
  await run(
    `CREATE (ch:Channel { uniqueName: 'test-channel', displayName: 'Test Channel' })
     CREATE (target:User { username: 'baduser', displayName: 'Bad User' })
     CREATE (i:Issue {
        id: 'issue-1', issueNumber: 1, isOpen: true,
        channelUniqueName: 'test-channel', relatedUsername: 'baduser',
        title: 'Report against baduser', authorName: 'Mod One', createdAt: datetime()
     })
     CREATE (ch)-[:HAS_ISSUE]->(i)`
  );
});

const ctx = () => modContext(env, mockToken({ username: "mod1", email: "mod1@e2e.test" }));

const suspendUser = (args: Record<string, unknown> = {}) =>
  env.resolvers.Mutation.suspendUser(
    null,
    {
      issueId: "issue-1",
      suspendIndefinitely: true,
      explanation: "Repeated rule violations",
      ...args,
    },
    ctx()
  );

test("suspendUser creates a Suspension, closes the issue, and records actions", async () => {
  await suspendUser();

  const suspensions = await run(
    `MATCH (s:Suspension { username: 'baduser' })
     RETURN s.channelUniqueName AS channel, s.suspendedIndefinitely AS indefinite`
  );
  assert.equal(suspensions.length, 1, "one Suspension should be created");
  assert.equal(suspensions[0].channel, "test-channel");
  assert.equal(suspensions[0].indefinite, true);

  const linked = await run(
    `MATCH (s:Suspension { username: 'baduser' })--(u:User { username: 'baduser' })
     RETURN count(DISTINCT u) AS n`
  );
  assert.equal(Number(linked[0].n), 1, "suspension should link to the target user");

  const issue = await run(`MATCH (i:Issue { id: 'issue-1' }) RETURN i.isOpen AS isOpen`);
  assert.equal(issue[0].isOpen, false, "issue should be closed after suspension");

  const actions = await run(
    `MATCH (i:Issue { id: 'issue-1' })-[:ACTIVITY_ON_ISSUE]->(a:ModerationAction)
     RETURN collect(a.actionType) AS types`
  );
  const types: string[] = actions[0].types;
  assert.ok(types.includes("suspension"), `got ${JSON.stringify(types)}`);
  assert.ok(types.includes("close"), `got ${JSON.stringify(types)}`);
});

test("suspendUser attaches the suspension to the channel", async () => {
  await suspendUser();
  const rel = await run(
    `MATCH (ch:Channel { uniqueName: 'test-channel' })-[:SUSPENDED_AS_USER]->(s:Suspension { username: 'baduser' })
     RETURN count(s) AS n`
  );
  assert.equal(Number(rel[0].n), 1);
});

test("suspendUser throws when the issue id is missing", async () => {
  await assert.rejects(suspendUser({ issueId: undefined }), /Issue ID is required/i);
});
