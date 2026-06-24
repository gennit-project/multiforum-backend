import test from "node:test";
import assert from "node:assert/strict";
import {
  extractModMentions,
  getNewModMentions,
  notifyModMentions,
} from "./modMentionNotificationHook.js";
import type { GraphQLContext } from "../types/context.js";

// Unit tests for extraction functions
test("extractModMentions extracts mod profile names from text", () => {
  const result = extractModMentions("Hello /m/alice and /m/bob_smith");
  assert.deepEqual(result, ["alice", "bob_smith"]);
});

test("extractModMentions returns empty array for null/undefined", () => {
  assert.deepEqual(extractModMentions(null), []);
  assert.deepEqual(extractModMentions(undefined), []);
  assert.deepEqual(extractModMentions(""), []);
});

test("extractModMentions handles text with no mentions", () => {
  const result = extractModMentions("Hello everyone!");
  assert.deepEqual(result, []);
});

test("extractModMentions handles multiple mentions of same mod", () => {
  const result = extractModMentions("Hey /m/alice, what do you think /m/alice?");
  assert.deepEqual(result, ["alice", "alice"]);
});

test("extractModMentions handles hyphens in mod names", () => {
  const result = extractModMentions("Thanks /m/mod-helper for your help!");
  assert.deepEqual(result, ["mod-helper"]);
});

test("getNewModMentions returns only new mentions", () => {
  const previousText = "Thanks /m/alice for the help";
  const nextText = "Thanks /m/alice and /m/bob for the help";
  const result = getNewModMentions(previousText, nextText);
  assert.deepEqual(result, ["bob"]);
});

test("getNewModMentions handles case-insensitive comparison", () => {
  const previousText = "Thanks /m/Alice";
  const nextText = "Thanks /m/alice and /m/BOB";
  const result = getNewModMentions(previousText, nextText);
  // Alice is already mentioned (case insensitive), only BOB is new
  assert.deepEqual(result, ["BOB"]);
});

test("getNewModMentions returns all mentions when previousText is null", () => {
  const result = getNewModMentions(null, "Hello /m/alice and /m/bob");
  assert.deepEqual(result, ["alice", "bob"]);
});

// Integration tests for notifyModMentions
const buildMockContext = (
  modProfiles: Array<{ displayName: string; username: string; notifyWhenTagged: boolean }>,
  createdNotifications: any[]
) => {
  return {
    driver: {
      session: () => ({
        run: async (_query: string, params: { modProfileNames: string[] }) => {
          // Filter mod profiles by the requested displayNames (simulating the WHERE clause)
          const requestedNames = params.modProfileNames || [];
          const matchingProfiles = modProfiles.filter((mp) =>
            requestedNames.includes(mp.displayName)
          );
          return {
            records: matchingProfiles.map((mp) => ({
              get: (field: string) => {
                if (field === "displayName") return mp.displayName;
                if (field === "username") return mp.username;
                if (field === "notifyWhenTagged") return mp.notifyWhenTagged;
                return null;
              },
            })),
          };
        },
        close: async () => {},
      }),
    },
    ogm: {
      model: () => ({
        async update(input: any) {
          const notification = input.update?.Notifications?.[0]?.create?.[0]?.node;
          if (notification) {
            createdNotifications.push({
              username: input.where.username,
              text: notification.text,
              notificationType: notification.notificationType,
            });
          }
          return { users: [{ username: input.where.username }] };
        },
      }),
    },
  } as unknown as GraphQLContext;
};

test("notifyModMentions sends notification to mentioned mod", async () => {
  process.env.FRONTEND_URL = "https://example.com";
  const createdNotifications: any[] = [];
  const modProfiles = [
    { displayName: "alice", username: "alice_user", notifyWhenTagged: true },
  ];

  const context = buildMockContext(modProfiles, createdNotifications);

  await notifyModMentions({
    context,
    mentionContext: {
      type: "comment",
      authorUsername: "commenter",
      authorLabel: "[@commenter](/u/commenter)",
      commentId: "comment-1",
      discussionId: "discussion-1",
      discussionTitle: "Test Discussion",
      channelUniqueName: "phoenix",
    },
    previousText: null,
    nextText: "Hey /m/alice can you take a look?",
  });

  assert.equal(createdNotifications.length, 1);
  assert.equal(createdNotifications[0].username, "alice_user");
  assert.equal(createdNotifications[0].notificationType, "mention");
  assert.match(createdNotifications[0].text, /mentioned you as a moderator/);
});

test("notifyModMentions does not notify the author mentioning themselves", async () => {
  process.env.FRONTEND_URL = "https://example.com";
  const createdNotifications: any[] = [];
  const modProfiles = [
    { displayName: "alice", username: "alice_user", notifyWhenTagged: true },
  ];

  const context = buildMockContext(modProfiles, createdNotifications);

  await notifyModMentions({
    context,
    mentionContext: {
      type: "comment",
      authorUsername: "alice_user",
      authorLabel: "[@alice_user](/u/alice_user)",
      commentId: "comment-1",
      discussionId: "discussion-1",
      discussionTitle: "Test Discussion",
      channelUniqueName: "phoenix",
    },
    previousText: null,
    nextText: "I'm /m/alice and I'm testing",
  });

  assert.equal(createdNotifications.length, 0);
});

test("notifyModMentions does not send duplicate notifications for edited text", async () => {
  process.env.FRONTEND_URL = "https://example.com";
  const createdNotifications: any[] = [];
  const modProfiles = [
    { displayName: "alice", username: "alice_user", notifyWhenTagged: true },
    { displayName: "bob", username: "bob_user", notifyWhenTagged: true },
  ];

  const context = buildMockContext(modProfiles, createdNotifications);

  await notifyModMentions({
    context,
    mentionContext: {
      type: "comment",
      authorUsername: "commenter",
      authorLabel: "[@commenter](/u/commenter)",
      commentId: "comment-1",
      discussionId: "discussion-1",
      discussionTitle: "Test Discussion",
      channelUniqueName: "phoenix",
    },
    previousText: "Hey /m/alice",
    nextText: "Hey /m/alice and /m/bob",
  });

  // Only bob should be notified since alice was already mentioned
  assert.equal(createdNotifications.length, 1);
  assert.equal(createdNotifications[0].username, "bob_user");
});

test("notifyModMentions builds correct URL for discussion comment", async () => {
  process.env.FRONTEND_URL = "https://example.com";
  const createdNotifications: any[] = [];
  const modProfiles = [
    { displayName: "alice", username: "alice_user", notifyWhenTagged: true },
  ];

  const context = buildMockContext(modProfiles, createdNotifications);

  await notifyModMentions({
    context,
    mentionContext: {
      type: "comment",
      authorUsername: "commenter",
      authorLabel: "[@commenter](/u/commenter)",
      commentId: "comment-1",
      discussionId: "discussion-1",
      discussionTitle: "Test Discussion",
      channelUniqueName: "phoenix",
    },
    previousText: null,
    nextText: "Hey /m/alice",
  });

  assert.equal(createdNotifications.length, 1);
  assert.match(
    createdNotifications[0].text,
    /\[Test Discussion\]\(https:\/\/example\.com\/forums\/phoenix\/discussions\/discussion-1\/comments\/comment-1\)/
  );
});

test("notifyModMentions builds correct URL for event comment", async () => {
  process.env.FRONTEND_URL = "https://example.com";
  const createdNotifications: any[] = [];
  const modProfiles = [
    { displayName: "alice", username: "alice_user", notifyWhenTagged: true },
  ];

  const context = buildMockContext(modProfiles, createdNotifications);

  await notifyModMentions({
    context,
    mentionContext: {
      type: "comment",
      authorUsername: "commenter",
      authorLabel: "[@commenter](/u/commenter)",
      commentId: "comment-1",
      eventId: "event-1",
      eventTitle: "Test Event",
      channelUniqueName: "phoenix",
    },
    previousText: null,
    nextText: "Hey /m/alice",
  });

  assert.equal(createdNotifications.length, 1);
  assert.match(
    createdNotifications[0].text,
    /\[Test Event\]\(https:\/\/example\.com\/forums\/phoenix\/events\/event-1\/comments\/comment-1\)/
  );
});

test("notifyModMentions handles issue mentions", async () => {
  process.env.FRONTEND_URL = "https://example.com";
  const createdNotifications: any[] = [];
  const modProfiles = [
    { displayName: "alice", username: "alice_user", notifyWhenTagged: true },
  ];

  const context = buildMockContext(modProfiles, createdNotifications);

  await notifyModMentions({
    context,
    mentionContext: {
      type: "comment",
      authorUsername: "commenter",
      authorLabel: "[@commenter](/u/commenter)",
      commentId: "comment-1",
      issueId: "issue-1",
      issueNumber: 42,
      channelUniqueName: "phoenix",
    },
    previousText: null,
    nextText: "Hey /m/alice check this issue",
  });

  assert.equal(createdNotifications.length, 1);
  assert.match(createdNotifications[0].text, /Issue #42/);
});

test("notifyModMentions does nothing when no new mentions", async () => {
  process.env.FRONTEND_URL = "https://example.com";
  const createdNotifications: any[] = [];
  const modProfiles = [
    { displayName: "alice", username: "alice_user", notifyWhenTagged: true },
  ];

  const context = buildMockContext(modProfiles, createdNotifications);

  await notifyModMentions({
    context,
    mentionContext: {
      type: "comment",
      authorUsername: "commenter",
      authorLabel: "[@commenter](/u/commenter)",
      commentId: "comment-1",
      discussionId: "discussion-1",
      discussionTitle: "Test Discussion",
      channelUniqueName: "phoenix",
    },
    previousText: "Hey /m/alice",
    nextText: "Hey /m/alice still here",
  });

  assert.equal(createdNotifications.length, 0);
});
