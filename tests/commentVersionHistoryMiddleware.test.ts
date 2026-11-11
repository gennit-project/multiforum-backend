import test from 'node:test';
import assert from 'node:assert/strict';
import type { GraphQLResolveInfo } from 'graphql';
import type { GraphQLContext } from '../types/context.js';
import middleware from '../middleware/commentVersionHistoryMiddleware.js';
import type { StringUpdate } from '../utils/stringUpdate.js';

function fixture({ moderatorAuthor = false, editor = 'editor', relatedIssue = false } = {}) {
  const revisions: Record<string, unknown>[] = [];
  const notifications: Array<{username: string; text: string}> = [];
  const calls: string[] = [];
  const activities: unknown[] = [];
  const snapshot = {
    id: 'c', text: 'old', CommentAuthor: moderatorAuthor
      ? { displayName: 'Original moderator', User: { username: 'author' } }
      : { username: 'author' },
    DiscussionChannel: { discussionId: 'd', channelUniqueName: 'forum', Discussion: { title: 'Discussion' } },
  };
  const context = {
    user: { username: editor, data: { ModerationProfile: { displayName: 'Editing moderator' } } },
    commentRevisionRepository: {
      findSnapshot: async (id: string) => { assert.equal(id, 'c'); calls.push('snapshot'); return [snapshot]; },
      findEditor: async (username: string) => [{ username }],
      createPreviousText: async (input: Record<string, unknown>) => { calls.push('revision'); revisions.push(input); return { textVersions: [{ id: 'v' }] }; },
      findCommentIds: async () => [{ id: 'c' }],
      connectPreviousText: async () => { calls.push('connect'); },
    },
    issueActivityRepository: {
      findRelatedIssueIds: async () => relatedIssue ? [{ id: 'issue' }] : [],
      appendActivity: async (id: string, activity: unknown) => { activities.push({ id, activity }); },
    },
    notificationSnapshotRepository: {
      findMentionRecipients: async (usernames: string[]) => { assert.deepEqual(usernames, ['mentioned']); return [{ username: 'mentioned' }]; },
    },
    notificationWriter: { createForUser: async (input: { username: string; text: string }) => { notifications.push(input); return true; } },
  } as unknown as GraphQLContext;
  const run = (text: StringUpdate | undefined, denied = false) => {
    const args = { where: { id: { eq: 'c' } }, update: { text } };
    return middleware.Mutation.updateComments(async (_parent, actualArgs) => {
      assert.equal(actualArgs, args);
      calls.push('resolve');
      if (denied) throw new Error('Forbidden');
      return 'updated';
    }, null, args, context, {} as GraphQLResolveInfo);
  };
  return { revisions, notifications, calls, activities, snapshot, run };
}

test('v7 SET preserves pre-edit text with editor attribution and sends new mentions', async () => {
  const f = fixture();
  assert.equal(await f.run({ set: 'new @mentioned' }), 'updated');
  assert.deepEqual(f.revisions, [{ body: 'old', Author: { connect: { where: { node: { username: 'editor' } } } } }]);
  assert.deepEqual(f.calls, ['snapshot', 'resolve', 'revision', 'connect']);
  assert.deepEqual(f.notifications.map(n => n.username), ['author', 'mentioned']);
});

for (const text of [{ set: 'old' }, {}, null, undefined]) {
  test(`no revisions or notifications for unchanged/absent SET ${JSON.stringify(text)}`, async () => {
    const f = fixture();
    await f.run(text);
    assert.deepEqual(f.revisions, []);
    assert.deepEqual(f.notifications, []);
    assert.ok(!f.calls.includes('connect'));
  });
}

for (const text of [{ set: '' }, { set: null }, 'legacy new text']) {
  test(`changed text retains history for ${JSON.stringify(text)}`, async () => {
    const f = fixture();
    await f.run(text);
    assert.equal(f.revisions.length, 1);
    assert.equal(f.revisions[0].body, 'old');
  });
}

test('denied resolver produces no revision, timestamp or notification side effects', async () => {
  const f = fixture();
  await assert.rejects(f.run({ set: 'new @mentioned' }, true), /Forbidden/);
  assert.deepEqual(f.calls, ['snapshot', 'resolve']);
  assert.deepEqual(f.revisions, []);
  assert.deepEqual(f.notifications, []);
});

for (const moderatorAuthor of [false, true]) {
  test(`edit preserves original author and moderator audit attribution (moderator author=${moderatorAuthor})`, async () => {
    const f = fixture({ moderatorAuthor, relatedIssue: true });
    const originalAuthor = structuredClone(f.snapshot.CommentAuthor);
    await f.run({ set: 'edited text' });
    assert.deepEqual(f.snapshot.CommentAuthor, originalAuthor);
    assert.deepEqual(f.notifications.map(n => n.username), ['author']);
    assert.match(f.notifications[0].text, /^Editing moderator edited your comment/);
    assert.deepEqual(f.activities, [{
      id: 'issue',
      activity: {
        actionDescription: 'edited the comment', actionType: 'edit',
        ModerationProfile: { connect: { where: { node: { displayName: 'Editing moderator' } } } },
        Comment: { connect: { where: { node: { id: 'c' } } } },
      },
    }]);
  });
}

test('author editing their own comment retains history without notifying themselves', async () => {
  const f = fixture({ editor: 'author' });
  await f.run({ set: 'self edit' });
  assert.deepEqual(f.revisions, [{ body: 'old', Author: { connect: { where: { node: { username: 'author' } } } } }]);
  assert.deepEqual(f.notifications, []);
});

test('v7 SET does not notify mentions already present in the previous text', async () => {
  const f = fixture();
  f.snapshot.text = 'old @mentioned';
  await f.run({ set: 'updated @mentioned' });
  assert.deepEqual(f.notifications.map(n => n.username), ['author']);
  assert.equal(f.revisions[0].body, 'old @mentioned');
});
