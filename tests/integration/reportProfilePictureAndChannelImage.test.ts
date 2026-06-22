// Integration tests for the server-scoped report resolvers: reportProfilePicture
// and reportChannelImage, against a live Neo4j.

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
});

const ctx = () => modContext(env, mockToken({ username: "mod1", email: "mod1@e2e.test" }));

// --- reportProfilePicture ---

const reportProfilePicture = (args: Record<string, unknown>) =>
  env.resolvers.Mutation.reportProfilePicture(null, args, ctx());

test("reportProfilePicture opens a server-scoped Issue for the target user", async () => {
  await run(
    `CREATE (:User { username: 'baduser', profilePicURL: 'https://example.com/bad.jpg' })`
  );

  await reportProfilePicture({
    username: "baduser",
    reportText: "Inappropriate profile picture",
    selectedServerRules: ["No inappropriate content"],
  });

  const issues = await run(
    `MATCH (i:Issue { relatedProfilePicUserId: 'baduser' })
     RETURN i.channelUniqueName AS channel, i.isOpen AS isOpen, i.flaggedServerRuleViolation AS flagged`
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].channel, null);
  assert.equal(issues[0].isOpen, true);
  assert.equal(issues[0].flagged, true);

  const actions = await run(
    `MATCH (i:Issue { relatedProfilePicUserId: 'baduser' })-[:ACTIVITY_ON_ISSUE]->(a:ModerationAction)
     RETURN collect(a.actionType) AS types`
  );
  assert.ok((actions[0].types as string[]).includes("report"));
});

test("reportProfilePicture throws when the user has no profile picture", async () => {
  await run(`CREATE (:User { username: 'nopic' })`);
  await assert.rejects(
    reportProfilePicture({
      username: "nopic",
      reportText: "x",
      selectedServerRules: ["rule"],
    }),
    /profile picture/i
  );
});

// --- reportChannelImage ---

const reportChannelImage = (args: Record<string, unknown>) =>
  env.resolvers.Mutation.reportChannelImage(null, args, ctx());

test("reportChannelImage opens a server-scoped Issue for a channel icon", async () => {
  await run(
    `CREATE (:Channel { uniqueName: 'badforum', displayName: 'Bad Forum', channelIconURL: 'https://example.com/icon.png' })`
  );

  await reportChannelImage({
    channelUniqueName: "badforum",
    imageType: "ICON",
    reportText: "Inappropriate channel icon",
    selectedServerRules: ["No inappropriate content"],
  });

  const issues = await run(
    `MATCH (i:Issue { relatedChannelIconName: 'badforum' })
     RETURN i.channelUniqueName AS channel, i.isOpen AS isOpen, i.flaggedServerRuleViolation AS flagged`
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].channel, null, "channel image reports are server-scoped");
  assert.equal(issues[0].isOpen, true);
  assert.equal(issues[0].flagged, true);

  const actions = await run(
    `MATCH (i:Issue { relatedChannelIconName: 'badforum' })-[:ACTIVITY_ON_ISSUE]->(a:ModerationAction)
     RETURN collect(a.actionType) AS types`
  );
  assert.ok((actions[0].types as string[]).includes("report"));
});

test("reportChannelImage throws when the channel lacks the requested image", async () => {
  await run(`CREATE (:Channel { uniqueName: 'noicon', displayName: 'No Icon' })`);
  await assert.rejects(
    reportChannelImage({
      channelUniqueName: "noicon",
      imageType: "ICON",
      reportText: "x",
      selectedServerRules: ["rule"],
    })
  );
});
