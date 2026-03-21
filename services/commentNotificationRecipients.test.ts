import test from "node:test";
import assert from "node:assert/strict";
import { resolveReplyNotificationRecipients } from "./commentNotificationRecipients.js";

test("resolveReplyNotificationRecipients includes author with global setting enabled", () => {
  const recipients = resolveReplyNotificationRecipients({
    commenterUsername: "alice",
    parentCommentAuthor: {
      __typename: "User",
      username: "cluse",
      notifyOnReplyToCommentByDefault: true,
      Email: { address: "cluse@example.com" },
    },
    subscribedUsers: [],
  });

  assert.deepEqual(recipients, [
    {
      username: "cluse",
      email: "cluse@example.com",
    },
  ]);
});

test("resolveReplyNotificationRecipients excludes author when global setting is disabled", () => {
  const recipients = resolveReplyNotificationRecipients({
    commenterUsername: "alice",
    parentCommentAuthor: {
      __typename: "User",
      username: "cluse",
      notifyOnReplyToCommentByDefault: false,
      Email: { address: "cluse@example.com" },
    },
    subscribedUsers: [],
  });

  assert.deepEqual(recipients, []);
});

test("resolveReplyNotificationRecipients merges explicit subscribers with author", () => {
  const recipients = resolveReplyNotificationRecipients({
    commenterUsername: "alice",
    parentCommentAuthor: {
      __typename: "User",
      username: "cluse",
      notifyOnReplyToCommentByDefault: true,
      Email: { address: "cluse@example.com" },
    },
    subscribedUsers: [
      {
        username: "cluse",
        Email: { address: null },
      },
      {
        username: "bob",
        Email: { address: "bob@example.com" },
      },
    ],
  });

  assert.deepEqual(recipients, [
    {
      username: "cluse",
      email: "cluse@example.com",
    },
    {
      username: "bob",
      email: "bob@example.com",
    },
  ]);
});

test("resolveReplyNotificationRecipients removes the replier from recipients", () => {
  const recipients = resolveReplyNotificationRecipients({
    commenterUsername: "alice",
    parentCommentAuthor: {
      __typename: "User",
      username: "alice",
      notifyOnReplyToCommentByDefault: true,
      Email: { address: "alice@example.com" },
    },
    subscribedUsers: [
      {
        username: "alice",
        Email: { address: "alice@example.com" },
      },
      {
        username: "bob",
        Email: { address: "bob@example.com" },
      },
    ],
  });

  assert.deepEqual(recipients, [
    {
      username: "bob",
      email: "bob@example.com",
    },
  ]);
});
