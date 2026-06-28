// Additional image-moderation integration coverage that the per-resolver tests
// don't exercise: channel-scoped report/archive (the album-image case), the
// BANNER variant of reportChannelImage, report idempotency (a second report
// reopens/append rather than duplicating the issue), and re-removal rejection.

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

const seedImage = () =>
  run(
    `CREATE (img:Image { id: 'img-1', url: 'https://example.com/pic.jpg', archived: false, permanentlyRemoved: false, scanStatus: 'PENDING' })
     CREATE (u:User { username: 'uploader1' })
     CREATE (u)-[:UPLOADED_IMAGE]->(img)`
  );

const reportImage = (args: Record<string, unknown> = {}) =>
  env.resolvers.Mutation.reportImage(
    null,
    { imageId: "img-1", reportText: "bad", selectedForumRules: [], selectedServerRules: [], channelUniqueName: null, ...args },
    ctx()
  );

const archiveImage = (args: Record<string, unknown> = {}) =>
  env.resolvers.Mutation.archiveImage(
    null,
    { imageId: "img-1", reportText: "bad", selectedForumRules: [], selectedServerRules: [], channelUniqueName: null, ...args },
    ctx()
  );

const reportChannelImage = (args: Record<string, unknown>) =>
  env.resolvers.Mutation.reportChannelImage(null, args, ctx());

const permanentlyRemoveImage = (args: Record<string, unknown> = {}) =>
  env.resolvers.Mutation.permanentlyRemoveImage(
    null,
    { imageId: "img-1", explanation: "remove", ...args },
    ctx()
  );

// --- channel-scoped report/archive (album images) ---

test("reportImage (channel-scoped) creates a channel Issue with a forum rule", async () => {
  await run(`CREATE (:Channel { uniqueName: 'cats', displayName: 'Cats' })`);
  await seedImage();

  await reportImage({ channelUniqueName: "cats", selectedForumRules: ["Be kind"] });

  const issues = await run(
    `MATCH (i:Issue { relatedImageId: 'img-1' })
     RETURN i.channelUniqueName AS channel, i.isOpen AS isOpen`
  );
  assert.equal(issues.length, 1, "one channel-scoped issue");
  assert.equal(issues[0].channel, "cats");

  const actions = await run(
    `MATCH (i:Issue { relatedImageId: 'img-1' })-[:ACTIVITY_ON_ISSUE]->(a:ModerationAction)
     RETURN collect(a.actionType) AS types`
  );
  assert.ok((actions[0].types as string[]).includes("report"));
});

test("archiveImage (channel-scoped) archives the image and opens a channel Issue", async () => {
  await run(`CREATE (:Channel { uniqueName: 'cats', displayName: 'Cats' })`);
  await seedImage();

  await archiveImage({ channelUniqueName: "cats", selectedForumRules: ["Be kind"] });

  const img = await run(
    `MATCH (i:Image { id: 'img-1' }) RETURN i.archived AS archived`
  );
  assert.equal(img[0].archived, true, "image is archived");

  const issues = await run(
    `MATCH (i:Issue { relatedImageId: 'img-1' })
     RETURN i.channelUniqueName AS channel`
  );
  assert.equal(issues[0].channel, "cats");

  const actions = await run(
    `MATCH (i:Issue { relatedImageId: 'img-1' })-[:ACTIVITY_ON_ISSUE]->(a:ModerationAction)
     RETURN collect(a.actionType) AS types`
  );
  const types = actions[0].types as string[];
  assert.ok(types.includes("archive"), `got ${JSON.stringify(types)}`);
});

// --- reportChannelImage BANNER (only ICON was covered) ---

test("reportChannelImage opens a server-scoped Issue for a channel banner", async () => {
  await run(
    `CREATE (:Channel { uniqueName: 'badforum', displayName: 'Bad Forum', channelBannerURL: 'https://example.com/banner.png' })`
  );

  await reportChannelImage({
    channelUniqueName: "badforum",
    imageType: "BANNER",
    reportText: "bad banner",
    selectedServerRules: ["No inappropriate content"],
  });

  const issues = await run(
    `MATCH (i:Issue { relatedChannelBannerName: 'badforum' })
     RETURN i.channelUniqueName AS channel, i.isOpen AS isOpen`
  );
  assert.equal(issues.length, 1, "one banner report issue");
  assert.equal(issues[0].channel, null, "channel image reports are server-scoped");
});

// --- idempotency ---

test("a second reportImage reopens the existing Issue and appends an action", async () => {
  await seedImage();

  await reportImage({ selectedServerRules: ["No inappropriate content"] });
  await reportImage({ selectedServerRules: ["No inappropriate content"] });

  const issues = await run(
    `MATCH (i:Issue { relatedImageId: 'img-1' }) RETURN count(i) AS n`
  );
  assert.equal(Number(issues[0].n), 1, "still exactly one issue for the image");

  const actions = await run(
    `MATCH (i:Issue { relatedImageId: 'img-1' })-[:ACTIVITY_ON_ISSUE]->(a:ModerationAction { actionType: 'report' })
     RETURN count(a) AS n`
  );
  assert.equal(Number(actions[0].n), 2, "both reports recorded on the one issue");
});

// --- re-removal rejection ---

test("permanentlyRemoveImage rejects a second removal of the same image", async () => {
  await seedImage();
  await permanentlyRemoveImage();

  await assert.rejects(
    permanentlyRemoveImage(),
    /already been permanently removed/i
  );
});
