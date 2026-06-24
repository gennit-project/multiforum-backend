// Integration tests for the issue activity-feed helpers against a live Neo4j
// container. createIssueActivityFeedItems writes a ModerationAction onto each
// related Issue (via an OGM nested-create, attributing it to a User or
// ModerationProfile and optionally linking a revision + comment) and then, for
// non-report actions, notifies issue subscribers through notifyIssueSubscribers
// (raw-Cypher Notification creation). The existing unit tests mock all of this;
// here we assert the real graph. Email sending no-ops without a mail provider.

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  getIssueIdsForRelated,
  createIssueActivityFeedItems,
} from "../../hooks/issueActivityFeedHelpers.js";
import {
  startImageModEnv,
  stopImageModEnv,
  resetDb,
  run,
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

const Issue = () => env.ogm.model("Issue");

const seedIssue = (id: string, issueNumber: number, extra = "") =>
  run(
    `CREATE (i:Issue { id: $id, issueNumber: $n, isOpen: true, createdAt: datetime(), title: 'My Issue', channelUniqueName: 'cats'${extra ? ", " + extra : ""} })`,
    { id, n: issueNumber }
  );

// --- getIssueIdsForRelated ---

test("getIssueIdsForRelated returns the ids of issues related to a comment", async () => {
  await run(
    `CREATE (:Issue { id: 'i1', issueNumber: 1, isOpen: true, createdAt: datetime(), relatedCommentId: 'c1' })
     CREATE (:Issue { id: 'i2', issueNumber: 2, isOpen: true, createdAt: datetime(), relatedCommentId: 'c1' })
     CREATE (:Issue { id: 'i3', issueNumber: 3, isOpen: true, createdAt: datetime(), relatedCommentId: 'other' })`
  );

  const ids = await getIssueIdsForRelated(Issue(), { commentId: "c1" });
  assert.deepEqual(ids.sort(), ["i1", "i2"]);
});

test("getIssueIdsForRelated returns [] when no related key is provided", async () => {
  const ids = await getIssueIdsForRelated(Issue(), {});
  assert.deepEqual(ids, []);
});

// --- createIssueActivityFeedItems ---

test("createIssueActivityFeedItems records a User-attributed action linking the revision and comment, and notifies subscribers", async () => {
  await seedIssue("i1", 1);
  await run(
    `MATCH (i:Issue { id: 'i1' })
     CREATE (:User { username: 'mod', createdAt: datetime() })
     CREATE (sub:User { username: 'sub', createdAt: datetime() })
     CREATE (i)<-[:SUBSCRIBED_TO_ISSUE]-(sub)
     CREATE (:TextVersion { id: 'tv1', body: 'old body' })
     CREATE (:Comment { id: 'c1', text: 'a comment', isRootComment: true, createdAt: datetime() })`
  );

  await createIssueActivityFeedItems({
    IssueModel: Issue(),
    driver: env.driver,
    issueIds: ["i1"],
    actionDescription: "edited the discussion body",
    actionType: "edit",
    attribution: { username: "mod" },
    actorUsername: "mod",
    revisionId: "tv1",
    commentId: "c1",
  });

  const action = await run(
    `MATCH (:Issue { id: 'i1' })-[:ACTIVITY_ON_ISSUE]->(ma:ModerationAction)
     OPTIONAL MATCH (ma)<-[:PERFORMED_MODERATION_ACTION]-(actor:User)
     OPTIONAL MATCH (ma)-[:HAS_REVISION]->(rev:TextVersion)
     OPTIONAL MATCH (ma)-[:MODERATED_COMMENT]->(c:Comment)
     RETURN ma.actionType AS actionType, ma.actionDescription AS desc,
            actor.username AS actor, rev.id AS revId, c.id AS commentId`
  );
  assert.equal(action.length, 1, "one activity-feed item should be created");
  assert.equal(action[0].actionType, "edit");
  assert.equal(action[0].desc, "edited the discussion body");
  assert.equal(action[0].actor, "mod", "action attributed to the user");
  assert.equal(action[0].revId, "tv1", "revision linked");
  assert.equal(action[0].commentId, "c1", "comment linked");

  const subNotifs = await run(
    `MATCH (:User { username: 'sub' })-[:HAS_NOTIFICATION]->(n:Notification)
     RETURN n.notificationType AS type`
  );
  assert.equal(subNotifs.length, 1, "the subscriber should be notified");
  assert.equal(subNotifs[0].type, "moderation");
});

test("createIssueActivityFeedItems attributes the action to a moderation profile when given one", async () => {
  await seedIssue("i1", 1);
  await run(`CREATE (:ModerationProfile { displayName: 'CoolMod' })`);

  await createIssueActivityFeedItems({
    IssueModel: Issue(),
    driver: env.driver,
    issueIds: ["i1"],
    actionDescription: "closed the issue",
    actionType: "close",
    attribution: { modProfileName: "CoolMod" },
  });

  const action = await run(
    `MATCH (:Issue { id: 'i1' })-[:ACTIVITY_ON_ISSUE]->(ma:ModerationAction)<-[:PERFORMED_MODERATION_ACTION]-(mp:ModerationProfile)
     RETURN mp.displayName AS modName, ma.actionType AS actionType`
  );
  assert.equal(action.length, 1);
  assert.equal(action[0].modName, "CoolMod");
  assert.equal(action[0].actionType, "close");
});

test("createIssueActivityFeedItems records a report action but does not notify subscribers", async () => {
  await seedIssue("i1", 1);
  await run(
    `MATCH (i:Issue { id: 'i1' })
     CREATE (:User { username: 'mod', createdAt: datetime() })
     CREATE (sub:User { username: 'sub', createdAt: datetime() })
     CREATE (i)<-[:SUBSCRIBED_TO_ISSUE]-(sub)`
  );

  await createIssueActivityFeedItems({
    IssueModel: Issue(),
    driver: env.driver,
    issueIds: ["i1"],
    actionDescription: "reported the content",
    actionType: "report",
    attribution: { username: "mod" },
    actorUsername: "mod",
  });

  const action = await run(
    `MATCH (:Issue { id: 'i1' })-[:ACTIVITY_ON_ISSUE]->(ma:ModerationAction) RETURN ma.actionType AS type`
  );
  assert.equal(action.length, 1, "the report action is still recorded");
  assert.equal(action[0].type, "report");

  const subNotifs = await run(
    `MATCH (:User { username: 'sub' })-[:HAS_NOTIFICATION]->(n:Notification) RETURN count(n) AS n`
  );
  assert.equal(Number(subNotifs[0].n), 0, "report actions do not notify subscribers");
});

test("createIssueActivityFeedItems does nothing when there is no attribution", async () => {
  await seedIssue("i1", 1);

  await createIssueActivityFeedItems({
    IssueModel: Issue(),
    driver: env.driver,
    issueIds: ["i1"],
    actionDescription: "mystery action",
    actionType: "edit",
    attribution: {},
  });

  const action = await run(
    `MATCH (:Issue { id: 'i1' })-[:ACTIVITY_ON_ISSUE]->(ma:ModerationAction) RETURN count(ma) AS n`
  );
  assert.equal(Number(action[0].n), 0, "no action without a user or mod profile");
});
