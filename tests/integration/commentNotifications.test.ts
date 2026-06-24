// Integration tests for the comment-notification pipeline's callable core
// (handleCommentCreatedNotification), extracted from the subscription class so
// it can run directly against a live Neo4j container. Covers the three fan-out
// paths that write Notification nodes — discussion, event, and reply — plus the
// commenter-exclusion rule. Email sending no-ops here because no mail provider
// is configured.

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { handleCommentCreatedNotification } from "../../services/commentNotificationHandler.js";
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

const deps = () => ({ ogm: env.ogm, driver: env.driver });

const notificationsFor = (username: string) =>
  run(
    `MATCH (:User { username: $username })-[:HAS_NOTIFICATION]->(n:Notification)
     RETURN n.text AS text, n.notificationType AS type`,
    { username }
  );

// --- Discussion comment ---

test("a comment on a discussion notifies subscribers but not the commenter", async () => {
  await run(
    `CREATE (bob:User { username: 'bob' })
     CREATE (alice:User { username: 'alice' })
     CREATE (ch:Channel { uniqueName: 'cats', createdAt: datetime() })
     CREATE (d:Discussion { id: 'd1', title: 'My Discussion', createdAt: datetime() })
     CREATE (dc:DiscussionChannel { id: 'dc1', discussionId: 'd1', channelUniqueName: 'cats', createdAt: datetime() })
     CREATE (c:Comment { id: 'c1', text: 'nice post', isRootComment: true, createdAt: datetime() })
     CREATE (dc)-[:POSTED_IN_CHANNEL]->(d)
     CREATE (dc)-[:POSTED_IN_CHANNEL]->(ch)
     CREATE (dc)-[:CONTAINS_COMMENT]->(c)
     CREATE (ch)-[:HAS_COMMENT]->(c)
     CREATE (bob)-[:AUTHORED_COMMENT]->(c)
     CREATE (alice)-[:SUBSCRIBED_TO_NOTIFICATIONS]->(dc)
     CREATE (bob)-[:SUBSCRIBED_TO_NOTIFICATIONS]->(dc)`
  );

  await handleCommentCreatedNotification(deps(), "c1");

  const aliceNotifs = await notificationsFor("alice");
  assert.equal(aliceNotifs.length, 1, "subscriber should be notified");
  assert.match(aliceNotifs[0].text, /My Discussion/);
  assert.equal(aliceNotifs[0].type, "reply");

  const bobNotifs = await notificationsFor("bob");
  assert.equal(bobNotifs.length, 0, "the commenter should not be notified of their own comment");
});

// --- Event comment ---

test("a comment on an event notifies subscribers", async () => {
  await run(
    `CREATE (bob:User { username: 'bob' })
     CREATE (alice:User { username: 'alice' })
     CREATE (ch:Channel { uniqueName: 'cats', createdAt: datetime() })
     CREATE (e:Event { id: 'e1', title: 'My Event' })
     CREATE (ec:EventChannel { id: 'ec1', channelUniqueName: 'cats', eventId: 'e1' })
     CREATE (c:Comment { id: 'c1', text: 'see you there', isRootComment: true, createdAt: datetime() })
     CREATE (ec)-[:POSTED_IN_CHANNEL]->(e)
     CREATE (ec)-[:POSTED_IN_CHANNEL]->(ch)
     CREATE (e)-[:HAS_COMMENT]->(c)
     CREATE (ch)-[:HAS_COMMENT]->(c)
     CREATE (bob)-[:AUTHORED_COMMENT]->(c)
     CREATE (alice)-[:SUBSCRIBED_TO_NOTIFICATIONS]->(e)`
  );

  await handleCommentCreatedNotification(deps(), "c1");

  const aliceNotifs = await notificationsFor("alice");
  assert.equal(aliceNotifs.length, 1, "event subscriber should be notified");
  assert.match(aliceNotifs[0].text, /My Event/);
});

// --- Reply ---

test("a reply notifies the parent comment author who opted in to reply notifications", async () => {
  await run(
    `CREATE (bob:User { username: 'bob' })
     CREATE (alice:User { username: 'alice', notifyOnReplyToCommentByDefault: true })
     CREATE (ch:Channel { uniqueName: 'cats', createdAt: datetime() })
     CREATE (d:Discussion { id: 'd1', title: 'My Discussion', createdAt: datetime() })
     CREATE (dc:DiscussionChannel { id: 'dc1', discussionId: 'd1', channelUniqueName: 'cats', createdAt: datetime() })
     CREATE (parent:Comment { id: 'p1', text: 'original', isRootComment: true, createdAt: datetime() })
     CREATE (reply:Comment { id: 'r1', text: 'a reply', isRootComment: false, createdAt: datetime() })
     CREATE (dc)-[:POSTED_IN_CHANNEL]->(d)
     CREATE (dc)-[:POSTED_IN_CHANNEL]->(ch)
     CREATE (dc)-[:CONTAINS_COMMENT]->(reply)
     CREATE (ch)-[:HAS_COMMENT]->(reply)
     CREATE (alice)-[:AUTHORED_COMMENT]->(parent)
     CREATE (bob)-[:AUTHORED_COMMENT]->(reply)
     CREATE (reply)-[:IS_REPLY_TO]->(parent)`
  );

  await handleCommentCreatedNotification(deps(), "r1");

  const aliceNotifs = await notificationsFor("alice");
  assert.equal(aliceNotifs.length, 1, "parent author should be notified of the reply");
  assert.match(aliceNotifs[0].text, /replied to your comment/);
});

test("a reply does not notify a parent author who opted out", async () => {
  await run(
    `CREATE (bob:User { username: 'bob' })
     CREATE (alice:User { username: 'alice', notifyOnReplyToCommentByDefault: false })
     CREATE (ch:Channel { uniqueName: 'cats', createdAt: datetime() })
     CREATE (d:Discussion { id: 'd1', title: 'My Discussion', createdAt: datetime() })
     CREATE (dc:DiscussionChannel { id: 'dc1', discussionId: 'd1', channelUniqueName: 'cats', createdAt: datetime() })
     CREATE (parent:Comment { id: 'p1', text: 'original', isRootComment: true, createdAt: datetime() })
     CREATE (reply:Comment { id: 'r1', text: 'a reply', isRootComment: false, createdAt: datetime() })
     CREATE (dc)-[:POSTED_IN_CHANNEL]->(d)
     CREATE (dc)-[:POSTED_IN_CHANNEL]->(ch)
     CREATE (dc)-[:CONTAINS_COMMENT]->(reply)
     CREATE (ch)-[:HAS_COMMENT]->(reply)
     CREATE (alice)-[:AUTHORED_COMMENT]->(parent)
     CREATE (bob)-[:AUTHORED_COMMENT]->(reply)
     CREATE (reply)-[:IS_REPLY_TO]->(parent)`
  );

  await handleCommentCreatedNotification(deps(), "r1");

  const aliceNotifs = await notificationsFor("alice");
  assert.equal(aliceNotifs.length, 0, "opted-out parent author should not be notified");
});

// --- Missing comment ---

test("handleCommentCreatedNotification is a no-op for an unknown comment id", async () => {
  await handleCommentCreatedNotification(deps(), "does-not-exist");
  const all = await run(`MATCH (n:Notification) RETURN count(n) AS n`);
  assert.equal(Number(all[0].n), 0);
});
