// Integration tests for channel-level moderation resolvers against live Neo4j:
// lockChannel, unlockChannel, reportChannel.

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
    `CREATE (:Channel { uniqueName: 'test-channel', displayName: 'Test Channel', locked: false })`
  );
});

const ctx = () => modContext(env, mockToken({ username: "mod1", email: "mod1@e2e.test" }));

const lockChannel = (args: Record<string, unknown> = {}) =>
  env.resolvers.Mutation.lockChannel(
    null,
    { channelUniqueName: "test-channel", reason: "Spam wave", ...args },
    ctx()
  );

const unlockChannel = (args: Record<string, unknown> = {}) =>
  env.resolvers.Mutation.unlockChannel(
    null,
    { channelUniqueName: "test-channel", reason: "Resolved", ...args },
    ctx()
  );

test("lockChannel sets locked + reason and opens an Issue with a lock_channel action", async () => {
  await lockChannel();

  const ch = await run(
    `MATCH (c:Channel { uniqueName: 'test-channel' })
     RETURN c.locked AS locked, c.lockReason AS reason, c.lockedAt AS at`
  );
  assert.equal(ch[0].locked, true);
  assert.equal(ch[0].reason, "Spam wave");
  assert.ok(ch[0].at, "lockedAt should be set");

  const actions = await run(
    `MATCH (i:Issue { relatedChannelUniqueName: 'test-channel' })-[:ACTIVITY_ON_ISSUE]->(a:ModerationAction)
     RETURN collect(a.actionType) AS types`
  );
  assert.ok(
    (actions[0].types as string[]).includes("lock_channel"),
    `got ${JSON.stringify(actions[0]?.types)}`
  );
});

test("lockChannel throws when the channel is already locked", async () => {
  await lockChannel();
  await assert.rejects(lockChannel(), /already locked/i);
});

test("lockChannel throws when no reason is given", async () => {
  await assert.rejects(lockChannel({ reason: "" }), /reason is required/i);
});

test("unlockChannel clears the locked state after a lock", async () => {
  await lockChannel();
  await unlockChannel();

  const ch = await run(
    `MATCH (c:Channel { uniqueName: 'test-channel' })
     RETURN c.locked AS locked, c.lockReason AS reason`
  );
  assert.equal(ch[0].locked, false);
  assert.equal(ch[0].reason, null);
});

test("unlockChannel throws when the channel is not locked", async () => {
  await assert.rejects(unlockChannel(), /not locked/i);
});

test("reportChannel opens a server-scoped Issue with a report action", async () => {
  await env.resolvers.Mutation.reportChannel(
    null,
    {
      channelUniqueName: "test-channel",
      reportText: "This channel violates server rules",
      selectedServerRules: ["No spam"],
    },
    ctx()
  );

  const issues = await run(
    `MATCH (i:Issue { relatedChannelUniqueName: 'test-channel' })
     RETURN i.channelUniqueName AS channel, i.isOpen AS isOpen, i.flaggedServerRuleViolation AS flagged`
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].channel, null);
  assert.equal(issues[0].isOpen, true);
  assert.equal(issues[0].flagged, true);

  const actions = await run(
    `MATCH (i:Issue { relatedChannelUniqueName: 'test-channel' })-[:ACTIVITY_ON_ISSUE]->(a:ModerationAction)
     RETURN collect(a.actionType) AS types`
  );
  assert.ok((actions[0].types as string[]).includes("report"));
});

test("reportChannel throws when no server rule is selected", async () => {
  await assert.rejects(
    env.resolvers.Mutation.reportChannel(
      null,
      {
        channelUniqueName: "test-channel",
        reportText: "x",
        selectedServerRules: [],
      },
      ctx()
    ),
    /server rule must be selected/i
  );
});
