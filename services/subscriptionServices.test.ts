import assert from 'node:assert/strict';
import test from 'node:test';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { CommentNotificationService } from './commentNotificationService.js';
import { CommentVersionHistoryService } from './commentVersionHistoryService.js';
import { DiscussionVersionHistoryService } from './discussionVersionHistoryService.js';
import { WikiPageVersionHistoryService } from './wikiPageVersionHistoryService.js';
import type { VersionHistoryRepository, RecordTextVersionInput } from './persistence/versionHistoryRepository.js';
import type { NotificationSnapshotRepository } from './persistence/notificationSnapshotRepository.js';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
for (const field of ['commentCreated', 'commentUpdated', 'discussionUpdated', 'wikiPageUpdated']) {
  test(`${field} replaces failed GraphQL subscription and handles the next event`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let subscriptions = 0;
    let closed = 0;
    let fail!: (reason: Error) => void;
    let emit!: (result: IteratorResult<unknown>) => void;
    const schema = makeExecutableSchema({
      typeDefs: `
        type Query { unused: String }
        type Entity { id: ID, text: String, title: String, body: String, editReason: String, updatedAt: String }
        type Payload { createdComment: Entity, updatedComment: Entity, updatedDiscussion: Entity, updatedWikiPage: Entity, previousValues: Entity, previousState: Entity }
        type Subscription { ${field}: Payload }
      `,
      resolvers: { Subscription: { [field]: { subscribe: () => {
        subscriptions++;
        if (subscriptions > 1) assert.equal(closed, subscriptions - 1);
        const source: AsyncIterableIterator<unknown> = {
          [Symbol.asyncIterator]() { return this; },
          next() { return new Promise((resolve, reject) => { emit = resolve; fail = reject; }); },
          async return() { closed++; emit({ done: true, value: undefined }); return { done: true, value: undefined }; },
        };
        return source;
      } } } },
    });
    const records: RecordTextVersionInput[] = [];
    const notifications: string[] = [];
    const repository: VersionHistoryRepository = {
      getCommentAuthorName: async () => 'alice',
      getDiscussionAuthorUsername: async () => 'alice',
      getWikiPageVersionAuthorUsername: async () => 'alice',
      recordTextVersion: async (input) => { records.push(input); return 'version'; },
    };
    const snapshot = {
      findCommentNotificationSnapshot: async (id: string) => { notifications.push(id); return []; },
    } as unknown as NotificationSnapshotRepository;
    const consumer = field === 'commentCreated' ? new CommentNotificationService(schema, undefined, snapshot)
      : field === 'commentUpdated' ? new CommentVersionHistoryService(schema, repository)
      : field === 'discussionUpdated' ? new DiscussionVersionHistoryService(schema, repository)
      : new WikiPageVersionHistoryService(schema, repository);
    await Promise.all([consumer.start(), consumer.start()]);
    await flush();
    assert.equal(subscriptions, 1);
    for (let attempt = 1; attempt <= 2; attempt++) {
      fail(new Error('source disconnected'));
      await flush();
      t.mock.timers.tick(5000);
      await flush();
      assert.equal(subscriptions, attempt + 1);
      const entity = { id: `entity-${attempt}`, text: 'new', body: 'new' };
      emit({ done: false, value: { [field]: {
        createdComment: entity, updatedComment: entity, updatedDiscussion: entity, updatedWikiPage: entity,
        previousValues: { text: 'old', body: 'old' }, previousState: { body: 'old' },
      } } });
      await flush();
      if (field === 'commentCreated') assert.equal(notifications[attempt - 1], entity.id);
      else {
        assert.equal(records[attempt - 1].parentId, entity.id);
        assert.equal(records[attempt - 1].body, field === 'commentUpdated' ? 'old' : 'new');
      }
    }
    await consumer.stop();
    assert.equal(closed, 3);
    t.mock.timers.tick(10000);
    await flush();
    assert.equal(subscriptions, 3);
  });
}
