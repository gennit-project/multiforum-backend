import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createIssueActivityFeedItems,
  getAttributionFromContext,
  getIssueIdsForRelated,
} from '../hooks/issueActivityFeedHelpers.js';

test('getAttributionFromContext returns username and mod profile name', () => {
  const context = {
    user: {
      username: 'alice',
      data: {
        ModerationProfile: {
          displayName: 'mod-alice',
        },
      },
    },
  };

  const attribution = getAttributionFromContext(context);
  assert.equal(attribution.username, 'alice');
  assert.equal(attribution.modProfileName, 'mod-alice');
});

test('getIssueIdsForRelated builds where clause and returns ids', async () => {
  let lastWhere: Record<string, string> | null = null;
  const IssueModel = {
    find: async ({ where }: { where: Record<string, string> }) => {
      lastWhere = where;
      return [{ id: 'issue-1' }, { id: 'issue-2' }];
    },
  };

  const issueIds = await getIssueIdsForRelated(IssueModel, {
    commentId: 'comment-123',
  });

  assert.deepEqual(lastWhere, { relatedCommentId: 'comment-123' });
  assert.deepEqual(issueIds, ['issue-1', 'issue-2']);
});

test('createIssueActivityFeedItems connects revision and comment when provided', async () => {
  const updateCalls: Array<Record<string, any>> = [];
  const IssueModel = {
    update: async (input: Record<string, any>) => {
      updateCalls.push(input);
    },
  };

  await createIssueActivityFeedItems({
    IssueModel,
    issueIds: ['issue-1'],
    actionDescription: 'deleted the comment',
    actionType: 'delete',
    attribution: { username: 'alice' },
    revisionId: 'revision-1',
    commentId: 'comment-1',
  });

  assert.equal(updateCalls.length, 1);
  const update = updateCalls[0];
  const activityNode = update.update.ActivityFeed[0].create[0].node;
  assert.equal(activityNode.actionDescription, 'deleted the comment');
  assert.equal(activityNode.actionType, 'delete');
  assert.equal(activityNode.User.connect.where.node.username, 'alice');
  assert.equal(activityNode.Revision.connect.where.node.id, 'revision-1');
  assert.equal(activityNode.Comment.connect.where.node.id, 'comment-1');
});
