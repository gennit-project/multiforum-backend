// Integration tests for updateDownloadLabels against live Neo4j. The resolver
// resolves the acting user via setUserDataOnContext, checks discussion
// ownership (or channel/server mod permission), then connects/disconnects
// FilterOption labels on the DiscussionChannel and records LabelChangeHistory.
// These tests exercise the owner path.

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  startImageModEnv,
  stopImageModEnv,
  resetDb,
  run,
  mockToken,
  modContext,
  seedModerator,
  type ImageModEnv,
} from "./imageModerationHarness.js";

let env: ImageModEnv;

before(async () => {
  env = await startImageModEnv();
  process.env.SERVER_CONFIG_NAME = "E2ETestServer";
}, { timeout: 240000 });

after(async () => {
  await stopImageModEnv();
});

beforeEach(async () => {
  await resetDb();
  await run(
    `CREATE (:ServerConfig { serverName: 'E2ETestServer' })
     CREATE (owner:User { username: 'test-owner', createdAt: datetime() })
     CREATE (rando:User { username: 'rando', createdAt: datetime() })
     CREATE (ch:Channel { uniqueName: 'test-channel', displayName: 'Test Channel', createdAt: datetime() })
     CREATE (modRole:ModChannelRole { canEditDiscussions: true })
     CREATE (ch)-[:HAS_DEFAULT_MOD_ROLE]->(modRole)
     CREATE (disc:Discussion { id: 'disc-1', title: 'Test Discussion', createdAt: datetime() })
     CREATE (owner)-[:POSTED_DISCUSSION]->(disc)
     CREATE (dc:DiscussionChannel { id: 'dc-1', discussionId: 'disc-1', channelUniqueName: 'test-channel', createdAt: datetime() })
     CREATE (dc)-[:POSTED_IN_CHANNEL]->(disc)
     CREATE (dc)-[:POSTED_IN_CHANNEL]->(ch)
     CREATE (fg:FilterGroup { id: 'fg-1', key: 'size', displayName: 'Size', order: 1, mode: 'INCLUDE' })
     CREATE (fo1:FilterOption { id: 'fo-1', value: 'small', displayName: 'Small', order: 1 })
     CREATE (fo2:FilterOption { id: 'fo-2', value: 'large', displayName: 'Large', order: 2 })
     CREATE (fg)-[:HAS_FILTER_OPTION]->(fo1)
     CREATE (fg)-[:HAS_FILTER_OPTION]->(fo2)`
  );
  await seedModerator({ username: "moddy", modDisplayName: "Moddy" });
});

const asOwner = () => modContext(env, mockToken({ username: "test-owner", email: "owner@e2e.test" }));

const updateLabels = (labelOptionIds: string[], context = asOwner()) =>
  env.resolvers.Mutation.updateDownloadLabels(
    null,
    { discussionId: "disc-1", channelUniqueName: "test-channel", labelOptionIds },
    context
  );

const asMod = () => modContext(env, mockToken({ username: "moddy", email: "moddy@e2e.test" }));

const connectedLabelValues = async () => {
  const rows = await run(
    `MATCH (:DiscussionChannel { id: 'dc-1' })-[:HAS_LABEL_OPTION]->(fo:FilterOption)
     RETURN fo.value AS value ORDER BY fo.value`
  );
  return rows.map((r) => r.value);
};

test("owner adds download labels and records 'added' history", async () => {
  await updateLabels(["fo-1", "fo-2"]);

  assert.deepEqual(await connectedLabelValues(), ["large", "small"]);

  const history = await run(
    `MATCH (:DiscussionChannel { id: 'dc-1' })-[:HAS_LABEL_CHANGE]->(h:LabelChangeHistory { actionType: 'added' })
     RETURN count(h) AS n`
  );
  assert.equal(Number(history[0].n), 2, "two 'added' history entries expected");
});

test("owner removing a label disconnects it and records 'removed' history", async () => {
  await updateLabels(["fo-1"]);
  await updateLabels([]); // remove all

  assert.deepEqual(await connectedLabelValues(), []);

  const removed = await run(
    `MATCH (:DiscussionChannel { id: 'dc-1' })-[:HAS_LABEL_CHANGE]->(h:LabelChangeHistory { actionType: 'removed' })
     RETURN count(h) AS n`
  );
  assert.ok(Number(removed[0].n) >= 1, "at least one 'removed' history entry expected");
});

test("attributes an owner's label change to the acting user (ActorUser)", async () => {
  await updateLabels(["fo-1"]);

  const userActor = await run(
    `MATCH (:User { username: 'test-owner' })-[:MADE_LABEL_CHANGE]->(h:LabelChangeHistory { actionType: 'added' })
     RETURN count(h) AS n`
  );
  assert.ok(
    Number(userActor[0].n) >= 1,
    "owner change should be attributed to the acting User"
  );

  const modActor = await run(
    `MATCH (:ModerationProfile)-[:MADE_LABEL_CHANGE]->(:LabelChangeHistory)
     RETURN count(*) AS n`
  );
  assert.equal(
    Number(modActor[0].n),
    0,
    "owner change should not be attributed to a moderator profile"
  );
});

test("an owner's label change does not create a ModerationAction", async () => {
  await updateLabels(["fo-1"]);

  const actions = await run(
    `MATCH (m:ModerationAction) RETURN count(m) AS n`
  );
  assert.equal(
    Number(actions[0].n),
    0,
    "owner self-edit should not create a moderation action"
  );
});

test("a non-owner moderator with canEditDiscussions can update labels", async () => {
  await updateLabels(["fo-1"], asMod());

  assert.deepEqual(await connectedLabelValues(), ["small"]);

  const modActor = await run(
    `MATCH (:ModerationProfile { displayName: 'Moddy' })-[:MADE_LABEL_CHANGE]->(h:LabelChangeHistory { actionType: 'added' })
     RETURN count(h) AS n`
  );
  assert.equal(Number(modActor[0].n), 1, "mod change should be attributed to the acting moderator profile");

  const userActor = await run(
    `MATCH (:User { username: 'moddy' })-[:MADE_LABEL_CHANGE]->(:LabelChangeHistory)
     RETURN count(*) AS n`
  );
  assert.equal(Number(userActor[0].n), 0, "mod change should not be attributed to the moderator's user account");

  const modAction = await run(
    `MATCH (:ModerationProfile { displayName: 'Moddy' })-[:PERFORMED_MODERATION_ACTION]->(m:ModerationAction { actionType: 'label_update' })
     RETURN count(m) AS n`
  );
  assert.equal(Number(modAction[0].n), 1, "mod change should create a label_update moderation action");
});

test("a non-owner without mod permission is rejected", async () => {
  await assert.rejects(
    updateLabels(["fo-1"], modContext(env, mockToken({ username: "rando", email: "r@e2e.test" }))),
    /moderator|permission/i
  );
});
