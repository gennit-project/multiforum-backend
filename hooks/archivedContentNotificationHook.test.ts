import test from 'node:test';
import assert from 'node:assert/strict';
import { notifyArchivedContentAuthor } from './archivedContentNotificationHook.js';

type NotifyContext = Parameters<typeof notifyArchivedContentAuthor>[0]['context'];

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

test('notifyArchivedContentAuthor sends notification to content author', async () => {
  process.env.FRONTEND_URL = 'https://example.com';
  process.env.SUPPORT_EMAIL = 'help@example.com';
  const createdNotifications: any[] = [];
  const users = [{ username: 'author' }];

  const context = {
    ogm: {
      model: () => buildMockUserModel(users, createdNotifications),
    },
  } as unknown as NotifyContext;

  const result = await notifyArchivedContentAuthor({
    context,
    contentType: 'comment',
    authorUsername: 'author',
    contentUrl: '/forums/cats/discussions/123/comments/456',
    channelUniqueName: 'cats',
    issueNumber: 42,
    moderatorUsername: 'mod',
  });

  assert.equal(result, true);
  assert.equal(createdNotifications.length, 1);
  assert.equal(createdNotifications[0].username, 'author');
  assert.equal(createdNotifications[0].notificationType, 'moderation');
  assert.match(createdNotifications[0].text, /comment/);
  assert.match(createdNotifications[0].text, /archived/);
  assert.match(createdNotifications[0].text, /Issue #42/);
  assert.match(createdNotifications[0].text, /help@example.com/);
});

test('notifyArchivedContentAuthor does not notify if author is the moderator', async () => {
  process.env.FRONTEND_URL = 'https://example.com';
  const createdNotifications: any[] = [];
  const users = [{ username: 'mod' }];

  const context = {
    ogm: {
      model: () => buildMockUserModel(users, createdNotifications),
    },
  } as unknown as NotifyContext;

  const result = await notifyArchivedContentAuthor({
    context,
    contentType: 'comment',
    authorUsername: 'mod',
    contentUrl: '/forums/cats/discussions/123/comments/456',
    channelUniqueName: 'cats',
    issueNumber: 42,
    moderatorUsername: 'mod',
  });

  assert.equal(result, false);
  assert.equal(createdNotifications.length, 0);
});

test('notifyArchivedContentAuthor returns false if user not found', async () => {
  process.env.FRONTEND_URL = 'https://example.com';
  const createdNotifications: any[] = [];
  const users: any[] = [];

  const context = {
    ogm: {
      model: () => buildMockUserModel(users, createdNotifications),
    },
  } as unknown as NotifyContext;

  const result = await notifyArchivedContentAuthor({
    context,
    contentType: 'discussion',
    authorUsername: 'nonexistent',
    contentUrl: '/forums/cats/discussions/123',
    channelUniqueName: 'cats',
    issueNumber: 42,
  });

  assert.equal(result, false);
  assert.equal(createdNotifications.length, 0);
});

test('notifyArchivedContentAuthor uses "post" for discussion content type', async () => {
  process.env.FRONTEND_URL = 'https://example.com';
  const createdNotifications: any[] = [];
  const users = [{ username: 'author' }];

  const context = {
    ogm: {
      model: () => buildMockUserModel(users, createdNotifications),
    },
  } as unknown as NotifyContext;

  await notifyArchivedContentAuthor({
    context,
    contentType: 'discussion',
    authorUsername: 'author',
    contentUrl: '/forums/cats/discussions/123',
    channelUniqueName: 'cats',
    issueNumber: 1,
  });

  assert.match(createdNotifications[0].text, /post/);
});

test('notifyArchivedContentAuthor includes issue link for appeal', async () => {
  process.env.FRONTEND_URL = 'https://example.com';
  const createdNotifications: any[] = [];
  const users = [{ username: 'author' }];

  const context = {
    ogm: {
      model: () => buildMockUserModel(users, createdNotifications),
    },
  } as unknown as NotifyContext;

  await notifyArchivedContentAuthor({
    context,
    contentType: 'image',
    authorUsername: 'author',
    contentUrl: '/forums/cats/images/123',
    channelUniqueName: 'cats',
    issueNumber: 99,
  });

  assert.match(createdNotifications[0].text, /\/forums\/cats\/issues\/99/);
  assert.match(createdNotifications[0].text, /request a review/);
});
