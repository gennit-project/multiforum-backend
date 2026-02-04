import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCommentMentionContext,
  CommentSnapshot,
} from './buildCommentMentionContext.js';

test('buildCommentMentionContext extracts discussion comment context', () => {
  const comment: CommentSnapshot = {
    id: 'comment-123',
    text: 'Hello world',
    CommentAuthor: {
      username: 'alice',
      displayName: 'Alice Smith',
    },
    DiscussionChannel: {
      discussionId: 'disc-456',
      channelUniqueName: 'test-forum',
      Discussion: {
        id: 'disc-456',
        title: 'Test Discussion',
      },
    },
  };

  const result = buildCommentMentionContext(comment);

  assert.deepEqual(result, {
    type: 'comment',
    commentId: 'comment-123',
    authorUsername: 'alice',
    authorLabel: 'Alice Smith',
    discussion: {
      id: 'disc-456',
      title: 'Test Discussion',
      channelUniqueName: 'test-forum',
    },
    event: null,
  });
});

test('buildCommentMentionContext extracts event comment context', () => {
  const comment: CommentSnapshot = {
    id: 'comment-123',
    text: 'Event comment',
    CommentAuthor: {
      username: 'bob',
      displayName: 'Bob Jones',
    },
    Event: {
      id: 'event-789',
      title: 'Test Event',
      EventChannels: [{ channelUniqueName: 'events-forum' }],
    },
  };

  const result = buildCommentMentionContext(comment);

  assert.deepEqual(result, {
    type: 'comment',
    commentId: 'comment-123',
    authorUsername: 'bob',
    authorLabel: 'Bob Jones',
    discussion: null,
    event: {
      id: 'event-789',
      title: 'Test Event',
      channelUniqueName: 'events-forum',
    },
  });
});

test('buildCommentMentionContext uses ModerationProfile User username', () => {
  const comment: CommentSnapshot = {
    id: 'comment-123',
    CommentAuthor: {
      displayName: 'Mod Profile',
      User: {
        username: 'mod-user',
      },
    },
  };

  const result = buildCommentMentionContext(comment);

  assert.equal(result.authorUsername, 'mod-user');
  assert.equal(result.authorLabel, 'Mod Profile');
});

test('buildCommentMentionContext uses username as label when no displayName', () => {
  const comment: CommentSnapshot = {
    id: 'comment-123',
    CommentAuthor: {
      username: 'charlie',
      displayName: null,
    },
  };

  const result = buildCommentMentionContext(comment);

  assert.equal(result.authorUsername, 'charlie');
  assert.equal(result.authorLabel, 'charlie');
});

test('buildCommentMentionContext uses "Someone" when no author', () => {
  const comment: CommentSnapshot = {
    id: 'comment-123',
    CommentAuthor: null,
  };

  const result = buildCommentMentionContext(comment);

  assert.equal(result.authorUsername, null);
  assert.equal(result.authorLabel, 'Someone');
});

test('buildCommentMentionContext uses default titles when missing', () => {
  const comment: CommentSnapshot = {
    id: 'comment-123',
    DiscussionChannel: {
      discussionId: 'disc-456',
      channelUniqueName: 'forum',
      Discussion: {
        id: 'disc-456',
        title: null,
      },
    },
  };

  const result = buildCommentMentionContext(comment);

  assert.equal(result.discussion?.title, 'discussion');
});

test('buildCommentMentionContext handles event with no channels', () => {
  const comment: CommentSnapshot = {
    id: 'comment-123',
    Event: {
      id: 'event-789',
      title: 'Test Event',
      EventChannels: [],
    },
  };

  const result = buildCommentMentionContext(comment);

  assert.equal(result.event, null);
});
