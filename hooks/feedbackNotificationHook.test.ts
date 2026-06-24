import test from "node:test";
import assert from "node:assert/strict";
import { notifyFeedback } from "./feedbackNotificationHook.js";
import type { GraphQLContext } from "../types/context.js";

type NotificationInput = {
  UserModel: any;
  username: string;
  text: string;
  notificationType?: string;
};

const buildMockUserModel = (users: any[], createdNotifications: any[]) => ({
  async find({ where }: { where: { username: string } }) {
    return users.filter((u) => u.username === where.username);
  },
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
});

test("notifyFeedback sends notification when user has notifyOnFeedback enabled", async () => {
  process.env.FRONTEND_URL = "https://example.com";
  const createdNotifications: any[] = [];
  const users = [
    { username: "contentAuthor", notifyOnFeedback: true },
  ];

  const context = {
    ogm: {
      model: () => buildMockUserModel(users, createdNotifications),
    },
  } as unknown as GraphQLContext;

  await notifyFeedback({
    context,
    feedbackContext: {
      feedbackCommentId: "feedback-comment-1",
      authorUsername: "moderator",
      authorDisplayName: "Moderator",
      targetType: "comment",
      targetId: "target-comment-1",
      channelUniqueName: "phoenix",
      discussionId: "discussion-1",
    },
    targetAuthorUsername: "contentAuthor",
  });

  assert.equal(createdNotifications.length, 1);
  assert.equal(createdNotifications[0].username, "contentAuthor");
  assert.equal(createdNotifications[0].notificationType, "feedback");
  assert.match(createdNotifications[0].text, /received feedback/);
  assert.match(createdNotifications[0].text, /comment/);
});

test("notifyFeedback does not send notification when notifyOnFeedback is disabled", async () => {
  process.env.FRONTEND_URL = "https://example.com";
  const createdNotifications: any[] = [];
  const users = [
    { username: "contentAuthor", notifyOnFeedback: false },
  ];

  const context = {
    ogm: {
      model: () => buildMockUserModel(users, createdNotifications),
    },
  } as unknown as GraphQLContext;

  await notifyFeedback({
    context,
    feedbackContext: {
      feedbackCommentId: "feedback-comment-1",
      authorUsername: "moderator",
      targetType: "comment",
      targetId: "target-comment-1",
      channelUniqueName: "phoenix",
      discussionId: "discussion-1",
    },
    targetAuthorUsername: "contentAuthor",
  });

  assert.equal(createdNotifications.length, 0);
});

test("notifyFeedback does not notify yourself", async () => {
  process.env.FRONTEND_URL = "https://example.com";
  const createdNotifications: any[] = [];
  const users = [
    { username: "selfUser", notifyOnFeedback: true },
  ];

  const context = {
    ogm: {
      model: () => buildMockUserModel(users, createdNotifications),
    },
  } as unknown as GraphQLContext;

  await notifyFeedback({
    context,
    feedbackContext: {
      feedbackCommentId: "feedback-comment-1",
      authorUsername: "selfUser",
      targetType: "comment",
      targetId: "target-comment-1",
      channelUniqueName: "phoenix",
      discussionId: "discussion-1",
    },
    targetAuthorUsername: "selfUser",
  });

  assert.equal(createdNotifications.length, 0);
});

test("notifyFeedback builds correct URL for discussion feedback", async () => {
  process.env.FRONTEND_URL = "https://example.com";
  const createdNotifications: any[] = [];
  const users = [
    { username: "contentAuthor", notifyOnFeedback: true },
  ];

  const context = {
    ogm: {
      model: () => buildMockUserModel(users, createdNotifications),
    },
  } as unknown as GraphQLContext;

  await notifyFeedback({
    context,
    feedbackContext: {
      feedbackCommentId: "feedback-comment-1",
      authorUsername: "moderator",
      targetType: "discussion",
      targetId: "discussion-123",
      channelUniqueName: "phoenix",
    },
    targetAuthorUsername: "contentAuthor",
  });

  assert.equal(createdNotifications.length, 1);
  assert.match(createdNotifications[0].text, /post/);
  assert.match(createdNotifications[0].text, /phoenix\/discussions\/discussion-123/);
});

test("notifyFeedback builds correct URL for event feedback", async () => {
  process.env.FRONTEND_URL = "https://example.com";
  const createdNotifications: any[] = [];
  const users = [
    { username: "contentAuthor", notifyOnFeedback: true },
  ];

  const context = {
    ogm: {
      model: () => buildMockUserModel(users, createdNotifications),
    },
  } as unknown as GraphQLContext;

  await notifyFeedback({
    context,
    feedbackContext: {
      feedbackCommentId: "feedback-comment-1",
      authorUsername: "moderator",
      targetType: "event",
      targetId: "event-456",
      channelUniqueName: "phoenix",
    },
    targetAuthorUsername: "contentAuthor",
  });

  assert.equal(createdNotifications.length, 1);
  assert.match(createdNotifications[0].text, /event/);
  assert.match(createdNotifications[0].text, /phoenix\/events\/event-456/);
});

test("notifyFeedback does NOT include feedback content in notification (privacy)", async () => {
  process.env.FRONTEND_URL = "https://example.com";
  const createdNotifications: any[] = [];
  const users = [
    { username: "contentAuthor", notifyOnFeedback: true },
  ];

  const context = {
    ogm: {
      model: () => buildMockUserModel(users, createdNotifications),
    },
  } as unknown as GraphQLContext;

  await notifyFeedback({
    context,
    feedbackContext: {
      feedbackCommentId: "feedback-comment-1",
      authorUsername: "moderator",
      authorDisplayName: "Moderator",
      targetType: "comment",
      targetId: "target-comment-1",
      channelUniqueName: "phoenix",
      discussionId: "discussion-1",
    },
    targetAuthorUsername: "contentAuthor",
  });

  assert.equal(createdNotifications.length, 1);
  // The notification text should NOT include the moderator's name or the feedback content
  // It should be generic like "You received feedback on your comment"
  assert.doesNotMatch(createdNotifications[0].text, /Moderator/);
});
