// Integration test for the reportImage resolver against a live Neo4j.
// Exercises the resolver's DB orchestration: creating a moderation Issue and a
// "report" ModerationAction for a reported image.

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

const seedImage = (id: string, url: string, uploader: string) =>
  run(
    `CREATE (img:Image { id: $id, url: $url, archived: false, permanentlyRemoved: false })
     CREATE (u:User { username: $uploader })
     CREATE (u)-[:UPLOADED_IMAGE]->(img)`,
    { id, url, uploader }
  );

const callReportImage = (args: Record<string, unknown>) => {
  const context = modContext(env, mockToken({ username: "mod1", email: "mod1@e2e.test" }));
  return env.resolvers.Mutation.reportImage(null, args, context);
};

test("creates a server-scoped Issue and a report ModerationAction", async () => {
  await seedModerator({ username: "mod1", modDisplayName: "Mod One" });
  await seedImage("img-1", "https://example.com/pic.jpg", "uploader1");

  await callReportImage({
    imageId: "img-1",
    reportText: "This image violates the rules",
    selectedForumRules: [],
    selectedServerRules: ["No inappropriate content"],
    channelUniqueName: null,
  });

  const issues = await run(
    `MATCH (i:Issue { relatedImageId: 'img-1' })
     RETURN i.isOpen AS isOpen, i.channelUniqueName AS channelUniqueName,
            i.flaggedServerRuleViolation AS flagged, i.relatedUsername AS relatedUsername`
  );
  assert.equal(issues.length, 1, "exactly one Issue should be created");
  assert.equal(issues[0].isOpen, true);
  assert.equal(issues[0].channelUniqueName, null);
  assert.equal(issues[0].flagged, true);

  const actions = await run(
    `MATCH (i:Issue { relatedImageId: 'img-1' })-[:ACTIVITY_ON_ISSUE]->(a:ModerationAction)
     RETURN a.actionType AS actionType`
  );
  assert.ok(
    actions.some((a) => a.actionType === "report"),
    `expected a 'report' action, got: ${JSON.stringify(actions)}`
  );
});

test("rejects a server-scoped report with no server rules selected", async () => {
  await seedModerator({ username: "mod1", modDisplayName: "Mod One" });
  await seedImage("img-1", "https://example.com/pic.jpg", "uploader1");

  await assert.rejects(
    callReportImage({
      imageId: "img-1",
      reportText: "forum rule but no server rule",
      selectedForumRules: ["A forum rule"],
      selectedServerRules: [],
      channelUniqueName: null,
    }),
    /server rule must be selected/
  );
});

test("throws when the image does not exist", async () => {
  await seedModerator({ username: "mod1", modDisplayName: "Mod One" });

  await assert.rejects(
    callReportImage({
      imageId: "missing",
      reportText: "ghost",
      selectedForumRules: [],
      selectedServerRules: ["rule"],
      channelUniqueName: null,
    }),
    /Image not found/
  );
});
