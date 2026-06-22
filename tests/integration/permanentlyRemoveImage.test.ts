// Integration test for the permanentlyRemoveImage resolver against live Neo4j.

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
    `CREATE (img:Image { id: 'img-1', url: 'https://example.com/pic.jpg', archived: false, permanentlyRemoved: false, scanStatus: 'PENDING' })
     CREATE (u:User { username: 'uploader1' })
     CREATE (u)-[:UPLOADED_IMAGE]->(img)`
  );
});

const remove = (overrides: Record<string, unknown> = {}) =>
  env.resolvers.Mutation.permanentlyRemoveImage(
    null,
    { imageId: "img-1", explanation: "Permanently removing", ...overrides },
    modContext(env, mockToken({ username: "mod1", email: "mod1@e2e.test" }))
  );

test("permanentlyRemoveImage marks the image removed and stamps the time", async () => {
  await remove();
  const img = await run(
    `MATCH (img:Image { id: 'img-1' })
     RETURN img.permanentlyRemoved AS removed, img.permanentlyRemovedAt AS at`
  );
  assert.equal(img[0].removed, true);
  assert.ok(img[0].at, "permanentlyRemovedAt should be set");
});

test("permanentlyRemoveImage creates a server-scoped Issue with removal + close actions", async () => {
  await remove();
  const issues = await run(
    `MATCH (i:Issue { relatedImageId: 'img-1' })
     RETURN i.channelUniqueName AS channel, i.isOpen AS isOpen`
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].channel, null);
  assert.equal(issues[0].isOpen, false);

  const actions = await run(
    `MATCH (i:Issue { relatedImageId: 'img-1' })-[:ACTIVITY_ON_ISSUE]->(a:ModerationAction)
     RETURN collect(a.actionType) AS types`
  );
  const types: string[] = actions[0].types;
  assert.ok(types.includes("permanent-removal"), `got ${JSON.stringify(types)}`);
  assert.ok(types.includes("close"), `got ${JSON.stringify(types)}`);
});

test("permanentlyRemoveImage records the removing moderator", async () => {
  await remove();
  const rel = await run(
    `MATCH (img:Image { id: 'img-1' })-[:REMOVED_IMAGE]-(mp:ModerationProfile)
     RETURN mp.displayName AS name`
  );
  assert.equal(rel[0]?.name, "Mod One");
});
