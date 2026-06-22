// Integration test for the archiveImage / unarchiveImage resolvers against a
// live Neo4j. Exercises the full archive flow: create an Issue, two
// ModerationActions (archive + close), and flip Image.archived.

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
    // scanStatus is a non-nullable enum (default PENDING via GraphQL); raw-Cypher
    // seeding bypasses the default, so set it explicitly or the OGM update fails.
    `CREATE (img:Image { id: 'img-1', url: 'https://example.com/pic.jpg', archived: false, permanentlyRemoved: false, scanStatus: 'PENDING' })
     CREATE (u:User { username: 'uploader1' })
     CREATE (u)-[:UPLOADED_IMAGE]->(img)`
  );
});

const ctx = () => modContext(env, mockToken({ username: "mod1", email: "mod1@e2e.test" }));

const archive = (overrides: Record<string, unknown> = {}) =>
  env.resolvers.Mutation.archiveImage(
    null,
    {
      imageId: "img-1",
      selectedForumRules: [],
      selectedServerRules: ["No inappropriate content"],
      reportText: "Archiving this image",
      channelUniqueName: null,
      ...overrides,
    },
    ctx()
  );

const unarchive = (overrides: Record<string, unknown> = {}) =>
  env.resolvers.Mutation.unarchiveImage(
    null,
    {
      imageId: "img-1",
      explanation: "Reinstating this image",
      channelUniqueName: null,
      ...overrides,
    },
    ctx()
  );

test("archiveImage flips archived, creates an Issue and archive + close actions", async () => {
  await archive();

  const img = await run(`MATCH (img:Image { id: 'img-1' }) RETURN img.archived AS archived`);
  assert.equal(img[0].archived, true);

  const issues = await run(
    `MATCH (i:Issue { relatedImageId: 'img-1' }) RETURN i.isOpen AS isOpen`
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].isOpen, false, "issue should be closed after archive");

  const actions = await run(
    `MATCH (i:Issue { relatedImageId: 'img-1' })-[:ACTIVITY_ON_ISSUE]->(a:ModerationAction)
     RETURN collect(a.actionType) AS types`
  );
  const types: string[] = actions[0].types;
  assert.ok(types.includes("archive"), `expected archive action, got ${JSON.stringify(types)}`);
  assert.ok(types.includes("close"), `expected close action, got ${JSON.stringify(types)}`);
});

test("archiveImage links the image to the issue via RelatedIssues", async () => {
  await archive();
  const linked = await run(
    `MATCH (i:Issue)-[:CITED_ISSUE]->(img:Image { id: 'img-1' }) RETURN count(i) AS n`
  );
  assert.equal(Number(linked[0].n), 1);
});

test("unarchiveImage throws when no issue exists for the image", async () => {
  // Archived image but no moderation Issue — unarchive has nothing to close.
  await run(`MATCH (img:Image { id: 'img-1' }) SET img.archived = true`);
  await assert.rejects(unarchive(), /Issue not found/i);
});

test("unarchiveImage flips archived back to false on an archived image", async () => {
  await archive();
  await unarchive();

  const img = await run(`MATCH (img:Image { id: 'img-1' }) RETURN img.archived AS archived`);
  assert.equal(img[0].archived, false);

  const actions = await run(
    `MATCH (i:Issue { relatedImageId: 'img-1' })-[:ACTIVITY_ON_ISSUE]->(a:ModerationAction)
     RETURN collect(a.actionType) AS types`
  );
  assert.ok(
    (actions[0].types as string[]).includes("un-archive"),
    `expected un-archive action, got ${JSON.stringify(actions[0].types)}`
  );
});
