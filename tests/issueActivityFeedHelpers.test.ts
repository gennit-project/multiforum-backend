import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createIssueActivityFeedItems,
  getAttributionFromContext,
  getIssueIdsForRelated,
} from '../hooks/issueActivityFeedHelpers.js';
import type { GraphQLContext } from '../types/context.js';
import type { IssueActivityRepository } from "../services/persistence/issueActivityRepository.js";

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

  const attribution = getAttributionFromContext(context as unknown as GraphQLContext);
  assert.equal(attribution.username, 'alice');
  assert.equal(attribution.modProfileName, 'mod-alice');
});

test('getIssueIdsForRelated builds where clause and returns ids', async () => {
  let lastWhere: Record<string, string> | null = null;
  const IssueModel = {
    findRelatedIssueIds: async (where: Record<string, string>) => {
      lastWhere = where;
      return [{ id: 'issue-1' }, { id: 'issue-2' }];
    },
  };

  const issueIds = await getIssueIdsForRelated(IssueModel as unknown as IssueActivityRepository, {
    commentId: 'comment-123',
  });

  assert.deepEqual(lastWhere, { relatedCommentId: { eq: 'comment-123' } });
  assert.deepEqual(issueIds, ['issue-1', 'issue-2']);
});

test('createIssueActivityFeedItems connects revision and comment when provided', async () => {
  const updateCalls: Array<Record<string, any>> = [];
  const IssueModel = {
    appendActivity: async (id: string, node: any) => {
      updateCalls.push({where: {id}, update: {ActivityFeed: [{create: [{node}]}]}});
    },
  };

  await createIssueActivityFeedItems({
    issueActivityRepository: IssueModel as unknown as IssueActivityRepository,
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

test('related reads combine every legacy scalar and retain duplicate ids', async () => {
  const calls: unknown[] = [];
  const repository: IssueActivityRepository = { appendActivity: async () => {}, findRelatedIssueIds: async where => { calls.push(where); return [{id:'a'}, {}, {id:'a'}]; } };
  assert.deepEqual(await getIssueIdsForRelated(repository, {}), []);
  assert.deepEqual(calls, []);
  assert.deepEqual(await getIssueIdsForRelated(repository, {discussionId:'d',commentId:'c',eventId:'e'}), ['a','a']);
  assert.deepEqual(calls, [{relatedDiscussionId:{eq:'d'},relatedCommentId:{eq:'c'},relatedEventId:{eq:'e'}}]);
});
test('related lookup failure is swallowed', async () => {
  assert.deepEqual(await getIssueIdsForRelated({findRelatedIssueIds:async()=>{throw Error('read');},appendActivity:async()=>{}},{commentId:'c'}), []);
});
test('activity keeps moderator priority, duplicate ids and sequential continuation after failure', async () => {
  const calls: string[] = [];
  const repository: IssueActivityRepository = {findRelatedIssueIds:async()=>[],appendActivity:async(id,node)=>{
    calls.push(id); assert.equal(node.User, undefined); assert.equal((node.ModerationProfile as any)?.connect?.where?.node?.displayName, 'mod');
    await Promise.resolve(); if(id==='bad') throw Error('write'); calls.push(`done:${id}`);
  }};
  await createIssueActivityFeedItems({issueActivityRepository:repository,issueIds:['a','bad','a'],attribution:{username:'u',modProfileName:'mod'},actionDescription:'edited'});
  assert.deepEqual(calls,['a','done:a','bad','a','done:a']);
});
test('empty ids and absent attribution do not write', async () => {
  const repository: IssueActivityRepository = {findRelatedIssueIds:async()=>[],appendActivity:async()=>{assert.fail('unexpected write');}};
  await createIssueActivityFeedItems({issueActivityRepository:repository,issueIds:[],attribution:{username:'u'},actionDescription:'x'});
  await createIssueActivityFeedItems({issueActivityRepository:repository,issueIds:['a'],attribution:{},actionDescription:'x'});
});

test('omitted driver suppresses notification and false/throw results retain sequential processing', async () => {
  const {buildSchema}=await import('graphql');
  const {registerGeneratedSchema}=await import('../services/persistence/generatedSchemaOperations.js');
  const driver={} as import('neo4j-driver').Driver;
  const schema=buildSchema(`input IDWhere {eq: ID} input IssueWhere {id: IDWhere} type Email {address:String} type User {username:String notifyOnSubscribedIssueUpdates:Boolean Email:Email} type Issue {id:ID issueNumber:Int title:String channelUniqueName:String SubscribedToNotifications:[User]} type Query {issues(where:IssueWhere):[Issue]}`);
  const calls:string[]=[];
  schema.getQueryType()!.getFields().issues.resolve=(_source,args)=>{calls.push(`notify:${args.where.id.eq}`);if(args.where.id.eq==='throw')throw Error('notification failed');return [];};
  registerGeneratedSchema(driver,schema);
  const repository:IssueActivityRepository={findRelatedIssueIds:async()=>[],appendActivity:async(id)=>{calls.push(`write:${id}`);}};
  const base={issueActivityRepository:repository,attribution:{username:'u'},actionDescription:'edited'};
  await createIssueActivityFeedItems({...base,issueIds:['no-driver']});
  assert.deepEqual(calls,['write:no-driver']);
  calls.length=0;
  await createIssueActivityFeedItems({...base,driver,issueIds:['false','throw','after']});
  assert.deepEqual(calls,['write:false','notify:false','write:throw','notify:throw','write:after','notify:after']);
});
