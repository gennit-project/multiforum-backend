// Integration test for reportWikiEdit against live Neo4j. Opens (or reuses) a
// channel-scoped moderation Issue for a reported wiki page edit, with a "report"
// ModerationAction.

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
    `CREATE (:WikiPage { id: 'wiki-1', title: 'Test Page', slug: 'test-page', channelUniqueName: 'test-channel', createdAt: datetime() })`
  );
});

const ctx = () => modContext(env, mockToken({ username: "mod1", email: "mod1@e2e.test" }));

const reportWikiEdit = (args: Record<string, unknown>) =>
  env.resolvers.Mutation.reportWikiEdit(
    null,
    {
      wikiPageId: "wiki-1",
      reportText: "This edit is vandalism",
      selectedForumRules: [],
      selectedServerRules: ["No vandalism"],
      channelUniqueName: "test-channel",
      ...args,
    },
    ctx()
  );

test("opens a channel-scoped Issue with a report action for the wiki page", async () => {
  await reportWikiEdit({});

  const issues = await run(
    `MATCH (i:Issue { relatedWikiPageId: 'wiki-1' })
     RETURN i.channelUniqueName AS channel, i.isOpen AS isOpen, i.flaggedServerRuleViolation AS flagged`
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].channel, "test-channel");
  assert.equal(issues[0].isOpen, true);
  assert.equal(issues[0].flagged, true);

  const actions = await run(
    `MATCH (i:Issue { relatedWikiPageId: 'wiki-1' })-[:ACTIVITY_ON_ISSUE]->(a:ModerationAction)
     RETURN collect(a.actionType) AS types`
  );
  assert.ok((actions[0].types as string[]).includes("report"));
});

test("reuses the existing Issue on a second report of the same wiki page", async () => {
  await reportWikiEdit({});
  await reportWikiEdit({ reportText: "still bad" });

  const issues = await run(
    `MATCH (i:Issue { relatedWikiPageId: 'wiki-1' }) RETURN count(i) AS n`
  );
  assert.equal(Number(issues[0].n), 1, "second report should reuse the same issue");
});

test("throws when no rule is selected", async () => {
  await assert.rejects(
    reportWikiEdit({ selectedForumRules: [], selectedServerRules: [] }),
    /At least one rule must be selected/i
  );
});

test("throws when the wiki page does not exist", async () => {
  await assert.rejects(
    reportWikiEdit({ wikiPageId: "ghost" }),
    /Wiki page not found/i
  );
});
