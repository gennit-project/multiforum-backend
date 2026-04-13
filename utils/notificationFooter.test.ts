import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildUnsubscribeUrl,
  buildNotificationFooter,
  appendNotificationFooter,
} from './notificationFooter.js';

describe('buildUnsubscribeUrl', () => {
  test('appends action=unsubscribe to URL without query params', () => {
    assert.equal(
      buildUnsubscribeUrl('/forums/cats/discussions/123'),
      '/forums/cats/discussions/123?action=unsubscribe'
    );
  });

  test('appends with & when URL already has query params', () => {
    assert.equal(
      buildUnsubscribeUrl('/forums/cats/discussions/123?sort=new'),
      '/forums/cats/discussions/123?sort=new&action=unsubscribe'
    );
  });

  test('returns empty string for empty URL', () => {
    assert.equal(buildUnsubscribeUrl(''), '');
  });
});

describe('buildNotificationFooter', () => {
  const originalEnv = process.env.FRONTEND_URL;

  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://example.com';
  });

  afterEach(() => {
    process.env.FRONTEND_URL = originalEnv;
  });

  test('builds footer for discussion with default subscription reason', () => {
    const footer = buildNotificationFooter({
      contentType: 'discussion',
      contentUrl: '/forums/cats/discussions/123',
      reason: 'default',
    });

    assert.ok(footer.includes('---'));
    assert.ok(footer.includes('you are subscribed by default'));
    assert.ok(footer.includes('[Notification settings](https://example.com/account_settings#notifications)'));
    assert.ok(footer.includes('[Unsubscribe](/forums/cats/discussions/123?action=unsubscribe)'));
  });

  test('builds footer for event with explicit subscription', () => {
    const footer = buildNotificationFooter({
      contentType: 'event',
      contentUrl: '/forums/cats/events/456',
      reason: 'subscribed',
    });

    assert.ok(footer.includes('you are subscribed to this event'));
    assert.ok(footer.includes('/forums/cats/events/456?action=unsubscribe'));
  });

  test('builds footer for issue', () => {
    const footer = buildNotificationFooter({
      contentType: 'issue',
      contentUrl: '/forums/cats/issues/789',
    });

    assert.ok(footer.includes('you are subscribed to this issue'));
    assert.ok(footer.includes('/forums/cats/issues/789?action=unsubscribe'));
  });

  test('builds footer for comment', () => {
    const footer = buildNotificationFooter({
      contentType: 'comment',
      contentUrl: '/forums/cats/discussions/123/comments/abc',
    });

    assert.ok(footer.includes('you are subscribed to this comment'));
  });

  test('defaults to subscribed reason when not specified', () => {
    const footer = buildNotificationFooter({
      contentType: 'discussion',
      contentUrl: '/test',
    });

    assert.ok(footer.includes('you are subscribed to this discussion'));
  });
});

describe('appendNotificationFooter', () => {
  const originalEnv = process.env.FRONTEND_URL;

  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://example.com';
  });

  afterEach(() => {
    process.env.FRONTEND_URL = originalEnv;
  });

  test('appends footer to existing notification text', () => {
    const originalText = 'Someone commented on your discussion [Title](/link)';
    const result = appendNotificationFooter(originalText, {
      contentType: 'discussion',
      contentUrl: '/forums/cats/discussions/123',
    });

    assert.ok(result.includes(originalText));
    assert.ok(result.includes('---'));
    assert.ok(result.includes('[Unsubscribe]'));
  });

  test('preserves markdown formatting in original text', () => {
    const originalText = '[@user](/u/user) replied to your comment';
    const result = appendNotificationFooter(originalText, {
      contentType: 'comment',
      contentUrl: '/forums/cats/discussions/123/comments/abc',
    });

    assert.ok(result.startsWith(originalText));
  });
});
