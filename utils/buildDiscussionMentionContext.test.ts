import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDiscussionMentionContext,
  DiscussionSnapshot,
} from './buildDiscussionMentionContext.js';

test('buildDiscussionMentionContext extracts all fields from complete snapshot', () => {
  const discussion: DiscussionSnapshot = {
    id: 'disc-123',
    title: 'Test Discussion',
    body: 'Discussion body',
    Author: {
      username: 'alice',
      displayName: 'Alice Smith',
    },
    DiscussionChannels: [{ channelUniqueName: 'test-forum' }],
  };

  const result = buildDiscussionMentionContext(discussion);

  assert.deepEqual(result, {
    type: 'discussion',
    discussionId: 'disc-123',
    title: 'Test Discussion',
    channelUniqueName: 'test-forum',
    authorUsername: 'alice',
    authorLabel: 'Alice Smith',
  });
});

test('buildDiscussionMentionContext uses username as label when no displayName', () => {
  const discussion: DiscussionSnapshot = {
    id: 'disc-123',
    title: 'Test',
    Author: {
      username: 'bob',
      displayName: null,
    },
    DiscussionChannels: [],
  };

  const result = buildDiscussionMentionContext(discussion);

  assert.equal(result.authorLabel, 'bob');
  assert.equal(result.authorUsername, 'bob');
});

test('buildDiscussionMentionContext uses "Someone" when no author info', () => {
  const discussion: DiscussionSnapshot = {
    id: 'disc-123',
    title: 'Test',
    Author: null,
  };

  const result = buildDiscussionMentionContext(discussion);

  assert.equal(result.authorLabel, 'Someone');
  assert.equal(result.authorUsername, null);
});

test('buildDiscussionMentionContext uses default title when missing', () => {
  const discussion: DiscussionSnapshot = {
    id: 'disc-123',
    title: null,
  };

  const result = buildDiscussionMentionContext(discussion);

  assert.equal(result.title, 'discussion');
});

test('buildDiscussionMentionContext handles missing channel', () => {
  const discussion: DiscussionSnapshot = {
    id: 'disc-123',
    title: 'Test',
    DiscussionChannels: [],
  };

  const result = buildDiscussionMentionContext(discussion);

  assert.equal(result.channelUniqueName, null);
});
