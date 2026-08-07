// Unit tests for the pure notification-email builders. Each returns an
// EmailContent { subject, plainText, html } from its inputs; we assert the
// subject and that the key content + link land in the body. No mail provider or
// DB is involved (sendEmailToUser, which does, is exercised by integration).
import assert from "node:assert/strict";
import test from "node:test";
import {
  createCommentNotificationEmail,
  createEventCommentNotificationEmail,
  createCommentReplyNotificationEmail,
  createEventUpdateNotificationEmail,
  createCommentMentionNotificationEmail,
  createDiscussionMentionNotificationEmail,
  createSeriesUpdateNotificationEmail,
  createIssueSubscriptionNotificationEmail,
} from "./emailUtils.js";

process.env.FRONTEND_URL = "https://app.example.test";

const hasAll = (s: string, ...parts: string[]) => parts.every((p) => s.includes(p));

test("createCommentNotificationEmail includes the discussion title, commenter, text and permalink", () => {
  const e = createCommentNotificationEmail("hello world", "My Discussion", "bob", "cats", "d-1", "c-9");
  assert.match(e.subject, /My Discussion/);
  assert.ok(hasAll(e.plainText, "bob", "My Discussion", "hello world"));
  assert.ok(e.plainText.includes("/forums/cats/discussions/d-1/comments/c-9"));
  assert.ok(e.html.includes("/forums/cats/discussions/d-1/comments/c-9"));
});

test("createEventCommentNotificationEmail references the event and comment", () => {
  const e = createEventCommentNotificationEmail("nice event", "Launch Party", "bob", "cats", "e-1", "c-2");
  assert.match(e.subject, /Launch Party/);
  assert.ok(hasAll(e.plainText, "bob", "Launch Party", "nice event"));
});

test("createCommentReplyNotificationEmail uses the provided content URL", () => {
  const url = "https://app.example.test/forums/cats/discussions/d-1/comments/c-3";
  const e = createCommentReplyNotificationEmail("thanks!", "Some Thread", "carol", url);
  assert.ok(hasAll(e.plainText, "carol", "thanks!", url));
  assert.ok(e.html.includes(url));
});

test("createEventUpdateNotificationEmail lists the summary lines and honors a subject override", () => {
  const e = createEventUpdateNotificationEmail("Meetup", ["Time changed", "Location changed"], "https://x.test/e", "Custom subject");
  assert.equal(e.subject, "Custom subject");
  assert.ok(hasAll(e.plainText, "Time changed", "Location changed", "https://x.test/e"));
  // default subject path when no override
  const d = createEventUpdateNotificationEmail("Meetup", ["Time changed"], "https://x.test/e");
  assert.match(d.subject, /Meetup/);
});

test("createCommentMentionNotificationEmail names the mentioner and links the comment", () => {
  const e = createCommentMentionNotificationEmail("@bob", "A Title", "https://x.test/c");
  assert.ok(hasAll(e.plainText, "@bob", "https://x.test/c"));
  assert.ok(e.html.includes("https://x.test/c"));
});

test("createDiscussionMentionNotificationEmail names the mentioner and links the discussion", () => {
  const e = createDiscussionMentionNotificationEmail("@bob", "Deep Dive", "https://x.test/d");
  assert.ok(hasAll(e.plainText, "@bob", "Deep Dive", "https://x.test/d"));
});

test("createSeriesUpdateNotificationEmail lists summary lines, describes scope, and supports a subject override", () => {
  const e = createSeriesUpdateNotificationEmail(
    "Weekly Sync", ["Now biweekly"], "https://x.test/s", "ALL_IN_SERIES", 3, "Series changed"
  );
  assert.equal(e.subject, "Series changed");
  assert.ok(hasAll(e.plainText, "Now biweekly", "https://x.test/s"));
  // default subject + scope description path
  const d = createSeriesUpdateNotificationEmail(
    "Weekly Sync", ["Now biweekly"], "https://x.test/s", "THIS_AND_FUTURE", 3
  );
  assert.match(d.subject, /Weekly Sync/);
  assert.ok(d.plainText.includes("future occurrence"));
});

test("createIssueSubscriptionNotificationEmail carries subject, summary, detail and link", () => {
  const e = createIssueSubscriptionNotificationEmail("New activity", "A comment was added", "full detail here", "https://x.test/i");
  assert.equal(e.subject, "New activity");
  assert.ok(hasAll(e.plainText, "A comment was added", "https://x.test/i"));
});
