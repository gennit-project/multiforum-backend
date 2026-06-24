// Integration tests for the lockChannel resolver against a live Neo4j
// container. lockChannel is the most involved moderation resolver: it
// authenticates a moderator, creates (or reuses) a server-scoped Issue,
// records a lock_channel ModerationAction with a reason Comment, locks the
// channel (LockedBy a ModerationProfile), and notifies channel admins via raw
// Cypher. It runs through the mock-auth seam (setUserDataOnContext), so the
// caller must be a seeded moderator.

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
});

const asMod = (username: string, email = "mod@test.com") =>
  modContext(env, mockToken({ username, email }));

const lockChannel = (args: Record<string, unknown>, ctx: any) =>
  env.resolvers.Mutation.lockChannel(null, args, ctx);

test("lockChannel locks the channel, opens a server issue with a lock action, and notifies admins", async () => {
  await seedModerator({ username: "modder", modDisplayName: "ModMan", email: "mod@test.com" });
  await run(
    `CREATE (ch:Channel { uniqueName: 'cats', displayName: 'Cats Forum', createdAt: datetime() })
     CREATE (admin:User { username: 'adminuser' })
     CREATE (admin)-[:ADMIN_OF_CHANNEL]->(ch)`
  );

  const result = await lockChannel(
    { channelUniqueName: "cats", reason: "Repeated spam" },
    asMod("modder")
  );
  assert.equal(result?.locked, true, "resolver returns the locked channel");

  const channel = await run(
    `MATCH (ch:Channel { uniqueName: 'cats' })
     OPTIONAL MATCH (ch)<-[:LOCKED_CHANNEL]-(mp:ModerationProfile)
     RETURN ch.locked AS locked, ch.lockReason AS reason, mp.displayName AS lockedBy`
  );
  assert.equal(channel[0].locked, true);
  assert.equal(channel[0].reason, "Repeated spam");
  assert.equal(channel[0].lockedBy, "ModMan", "locked by the moderator's profile");

  const issue = await run(
    `MATCH (i:Issue { relatedChannelUniqueName: 'cats' })
     RETURN i.title AS title, i.isOpen AS isOpen, i.channelUniqueName AS channelScoped,
            i.flaggedServerRuleViolation AS flagged`
  );
  assert.equal(issue.length, 1, "a server-scoped issue is created");
  assert.match(issue[0].title, /\[Locked channel\]/);
  assert.equal(issue[0].isOpen, true);
  assert.equal(issue[0].channelScoped, null, "issue is server-scoped (channelUniqueName null)");
  assert.equal(issue[0].flagged, true);

  const action = await run(
    `MATCH (:Issue { relatedChannelUniqueName: 'cats' })-[:ACTIVITY_ON_ISSUE]->(ma:ModerationAction)
     OPTIONAL MATCH (ma)-[:MODERATED_COMMENT]->(c:Comment)
     RETURN ma.actionType AS actionType, c.text AS commentText`
  );
  assert.equal(action.length, 1);
  assert.equal(action[0].actionType, "lock_channel");
  assert.match(action[0].commentText, /Reason for locking/);

  const notif = await run(
    `MATCH (:User { username: 'adminuser' })-[:HAS_NOTIFICATION]->(n:Notification)
     RETURN n.text AS text`
  );
  assert.equal(notif.length, 1, "the channel admin is notified");
  assert.match(notif[0].text, /has been locked/i);
});

test("lockChannel reuses an existing open server issue instead of creating a new one", async () => {
  await seedModerator({ username: "modder", modDisplayName: "ModMan", email: "mod@test.com" });
  await run(
    `CREATE (:Channel { uniqueName: 'cats', displayName: 'Cats Forum', createdAt: datetime() })
     CREATE (:Issue { id: 'existing', issueNumber: 1, isOpen: true, createdAt: datetime(),
                      relatedChannelUniqueName: 'cats', title: 'pre-existing' })`
  );

  await lockChannel({ channelUniqueName: "cats", reason: "spam" }, asMod("modder"));

  const issues = await run(
    `MATCH (i:Issue { relatedChannelUniqueName: 'cats' }) RETURN count(i) AS n`
  );
  assert.equal(Number(issues[0].n), 1, "no second issue created; the existing one is reused");

  const action = await run(
    `MATCH (:Issue { id: 'existing' })-[:ACTIVITY_ON_ISSUE]->(ma:ModerationAction)
     RETURN ma.actionType AS actionType`
  );
  assert.equal(action.length, 1, "the lock action is attached to the existing issue");
  assert.equal(action[0].actionType, "lock_channel");
});

test("lockChannel rejects a caller who is not a moderator", async () => {
  await run(
    `CREATE (:User { username: 'plain' })
     CREATE (:Channel { uniqueName: 'cats', createdAt: datetime() })`
  );

  await assert.rejects(
    lockChannel({ channelUniqueName: "cats", reason: "spam" }, asMod("plain")),
    /not a moderator/i
  );

  const channel = await run(`MATCH (ch:Channel { uniqueName: 'cats' }) RETURN ch.locked AS locked`);
  assert.notEqual(channel[0].locked, true, "channel stays unlocked");
});

test("lockChannel rejects when the channel is already locked", async () => {
  await seedModerator({ username: "modder", modDisplayName: "ModMan", email: "mod@test.com" });
  await run(`CREATE (:Channel { uniqueName: 'cats', locked: true, createdAt: datetime() })`);

  await assert.rejects(
    lockChannel({ channelUniqueName: "cats", reason: "spam" }, asMod("modder")),
    /already locked/i
  );
});

test("lockChannel requires a reason", async () => {
  await seedModerator({ username: "modder", modDisplayName: "ModMan", email: "mod@test.com" });
  await run(`CREATE (:Channel { uniqueName: 'cats', createdAt: datetime() })`);

  await assert.rejects(
    lockChannel({ channelUniqueName: "cats", reason: "   " }, asMod("modder")),
    /reason is required/i
  );
});
