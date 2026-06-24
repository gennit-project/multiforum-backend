// Integration tests for the notification hooks against a live Neo4j container.
// These hooks are invoked by the comment-notification handler and write
// Notification nodes through createInAppNotification (an OGM nested-create that
// no mock-based unit test actually exercises against a real database). Here we
// run the real notify* entry points and assert the resulting graph.
//
// Email sending no-ops because no mail provider is configured.

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { notifyFeedback } from "../../hooks/feedbackNotificationHook.js";
import { notifyModMentions } from "../../hooks/modMentionNotificationHook.js";
import { notifyCommentMentions } from "../../hooks/userMentionNotificationHook.js";
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

const ctx = () => ({ ogm: env.ogm, driver: env.driver });

const notificationsFor = (username: string) =>
  run(
    `MATCH (:User { username: $username })-[:HAS_NOTIFICATION]->(n:Notification)
     RETURN n.text AS text, n.notificationType AS type`,
    { username }
  );

// --- feedback ---

test("notifyFeedback creates a feedback notification for an opted-in author", async () => {
  await run(`CREATE (:User { username: 'author', notifyOnFeedback: true })`);

  await notifyFeedback({
    context: ctx(),
    feedbackContext: {
      feedbackCommentId: "fc1",
      authorUsername: "critic",
      authorDisplayName: "Critic",
      targetType: "discussion",
      targetId: "d1",
      channelUniqueName: "cats",
      discussionId: "d1",
    },
    targetAuthorUsername: "author",
  });

  const notifs = await notificationsFor("author");
  assert.equal(notifs.length, 1, "opted-in author should get a feedback notification");
  assert.equal(notifs[0].type, "feedback");
  assert.match(notifs[0].text, /received feedback/i);
});

test("notifyFeedback does nothing when the author opted out", async () => {
  await run(`CREATE (:User { username: 'author', notifyOnFeedback: false })`);

  await notifyFeedback({
    context: ctx(),
    feedbackContext: {
      feedbackCommentId: "fc1",
      authorUsername: "critic",
      targetType: "discussion",
      targetId: "d1",
      channelUniqueName: "cats",
      discussionId: "d1",
    },
    targetAuthorUsername: "author",
  });

  assert.equal((await notificationsFor("author")).length, 0);
});

// --- mod mentions ---

test("notifyModMentions notifies the user behind a mentioned moderation profile", async () => {
  await run(
    `CREATE (u:User { username: 'modder', notifyWhenTagged: true })
     CREATE (u)-[:MODERATION_PROFILE]->(:ModerationProfile { displayName: 'CoolMod' })`
  );

  await notifyModMentions({
    context: ctx(),
    mentionContext: {
      type: "comment",
      authorUsername: "bob",
      authorLabel: "[@bob](/u/bob)",
      commentId: "c1",
      discussionId: "d1",
      discussionTitle: "My Discussion",
      channelUniqueName: "cats",
    },
    previousText: null,
    nextText: "hey /m/CoolMod take a look",
  });

  const notifs = await notificationsFor("modder");
  assert.equal(notifs.length, 1, "mentioned moderator's user should be notified");
  assert.equal(notifs[0].type, "mention");
  assert.match(notifs[0].text, /mentioned you as a moderator/i);
});

test("notifyModMentions does not notify the comment author who mentions their own mod profile", async () => {
  await run(
    `CREATE (u:User { username: 'bob' })
     CREATE (u)-[:MODERATION_PROFILE]->(:ModerationProfile { displayName: 'BobMod' })`
  );

  await notifyModMentions({
    context: ctx(),
    mentionContext: {
      type: "comment",
      authorUsername: "bob",
      authorLabel: "[@bob](/u/bob)",
      commentId: "c1",
      discussionId: "d1",
      discussionTitle: "My Discussion",
      channelUniqueName: "cats",
    },
    previousText: null,
    nextText: "talking to myself /m/BobMod",
  });

  assert.equal((await notificationsFor("bob")).length, 0);
});

// --- user mentions ---

test("notifyCommentMentions notifies a newly mentioned user", async () => {
  await run(`CREATE (:User { username: 'alice', notifyWhenTagged: true })`);

  await notifyCommentMentions({
    context: ctx(),
    comment: {
      id: "c1",
      text: "hi @alice",
      CommentAuthor: { username: "bob" },
      DiscussionChannel: {
        discussionId: "d1",
        channelUniqueName: "cats",
        Discussion: { title: "My Discussion" },
      },
      Event: null,
    },
    previousText: null,
    nextText: "hi @alice",
  });

  const notifs = await notificationsFor("alice");
  assert.equal(notifs.length, 1, "mentioned user should be notified");
  assert.match(notifs[0].text, /mentioned you in a comment/i);
});

test("notifyCommentMentions does not notify the author mentioning themselves", async () => {
  await run(`CREATE (:User { username: 'bob' })`);

  await notifyCommentMentions({
    context: ctx(),
    comment: {
      id: "c1",
      text: "note to self @bob",
      CommentAuthor: { username: "bob" },
      DiscussionChannel: {
        discussionId: "d1",
        channelUniqueName: "cats",
        Discussion: { title: "My Discussion" },
      },
      Event: null,
    },
    previousText: null,
    nextText: "note to self @bob",
  });

  assert.equal((await notificationsFor("bob")).length, 0);
});
