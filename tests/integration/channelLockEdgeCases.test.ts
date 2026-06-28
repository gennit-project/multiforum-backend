// Integration tests for channel lock/unlock/report edge cases against live
// Neo4j, complementing lockChannel.test.ts and channelModeration.test.ts (which
// cover the happy paths). These focus on cross-mutation interactions and
// cleanup the existing suites don't assert:
//
//   - unlock leaves the issue OPEN, records an unlock_channel action, and
//     disconnects the LockedBy ModerationProfile (lock-state cleanup)
//   - report-then-lock funnels into a SINGLE server-scoped issue carrying both
//     the report and lock_channel actions (issue de-duplication)
//   - admin notifications: every admin is notified, no admins is graceful, and
//     the unlock notification differs from the lock one
//
// We call the resolvers directly via the harness (the shield/permission wiring
// is covered separately by the auth tests).

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
  await seedModerator({ username: "mod1", modDisplayName: "Mod One", email: "mod1@e2e.test" });
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

const reportChannel = (args: Record<string, unknown> = {}) =>
  env.resolvers.Mutation.reportChannel(
    null,
    {
      channelUniqueName: "test-channel",
      reportText: "Violates server rules",
      selectedServerRules: ["No spam"],
      ...args,
    },
    ctx()
  );

const createChannel = (admins: string[] = []) =>
  run(
    `CREATE (c:Channel { uniqueName: 'test-channel', displayName: 'Test Channel', locked: false })
     WITH c
     UNWIND $admins AS adminName
     CREATE (:User { username: adminName })-[:ADMIN_OF_CHANNEL]->(c)`,
    { admins }
  );

// --- Unlock: issue state + LockedBy cleanup ---

test("unlock leaves the related issue open and records an unlock_channel action", async () => {
  await createChannel();
  await lockChannel();
  await unlockChannel();

  const issue = await run(
    `MATCH (i:Issue { relatedChannelUniqueName: 'test-channel' })-[:ACTIVITY_ON_ISSUE]->(a:ModerationAction)
     RETURN i.isOpen AS isOpen, collect(a.actionType) AS types`
  );
  assert.deepEqual(
    { isOpen: issue[0].isOpen, hasLock: (issue[0].types as string[]).includes("lock_channel"), hasUnlock: (issue[0].types as string[]).includes("unlock_channel") },
    { isOpen: true, hasLock: true, hasUnlock: true }
  );
});

test("unlock disconnects the LockedBy moderation profile", async () => {
  await createChannel();
  await lockChannel();
  await unlockChannel();

  const lockedBy = await run(
    `MATCH (c:Channel { uniqueName: 'test-channel' })
     OPTIONAL MATCH (c)<-[:LOCKED_CHANNEL]-(mp:ModerationProfile)
     RETURN c.locked AS locked, c.lockedAt AS lockedAt, c.lockReason AS reason, mp.displayName AS lockedBy`
  );
  assert.deepEqual(lockedBy[0], { locked: false, lockedAt: null, reason: null, lockedBy: null });
});

// --- Report then lock: single issue carries both actions ---

test("reporting then locking a channel funnels both actions into one server-scoped issue", async () => {
  await createChannel();
  await reportChannel();
  await lockChannel();

  const issues = await run(
    `MATCH (i:Issue { relatedChannelUniqueName: 'test-channel' }) RETURN count(i) AS n`
  );
  assert.equal(Number(issues[0].n), 1, "report and lock share a single issue");
});

test("the shared report+lock issue carries both the report and lock_channel actions", async () => {
  await createChannel();
  await reportChannel();
  await lockChannel();

  const actions = await run(
    `MATCH (:Issue { relatedChannelUniqueName: 'test-channel' })-[:ACTIVITY_ON_ISSUE]->(a:ModerationAction)
     RETURN collect(a.actionType) AS types`
  );
  const types = (actions[0].types as string[]).sort();
  assert.deepEqual(types, ["lock_channel", "report"]);
});

// --- Notification edge cases ---

test("locking notifies every channel admin", async () => {
  await createChannel(["admin1", "admin2", "admin3"]);
  await lockChannel();

  const notified = await run(
    `MATCH (u:User)-[:HAS_NOTIFICATION]->(n:Notification)
     WHERE n.text CONTAINS 'has been locked'
     RETURN collect(u.username) AS users`
  );
  assert.deepEqual((notified[0].users as string[]).sort(), ["admin1", "admin2", "admin3"]);
});

test("locking a channel with no admins succeeds without creating notifications", async () => {
  await createChannel([]);
  const result = await lockChannel();

  const notifs = await run(`MATCH (n:Notification) RETURN count(n) AS n`);
  assert.deepEqual({ locked: result?.locked, notifications: Number(notifs[0].n) }, { locked: true, notifications: 0 });
});

test("unlocking notifies admins with an unlock message distinct from the lock one", async () => {
  await createChannel(["admin1"]);
  await lockChannel();
  await unlockChannel();

  const notifs = await run(
    `MATCH (:User { username: 'admin1' })-[:HAS_NOTIFICATION]->(n:Notification)
     RETURN collect(n.text) AS texts`
  );
  const texts = notifs[0].texts as string[];
  assert.equal(
    texts.some((t) => /has been unlocked/i.test(t)) && texts.some((t) => /has been locked/i.test(t)),
    true
  );
});
