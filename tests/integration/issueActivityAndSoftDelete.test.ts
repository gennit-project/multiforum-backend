import assert from 'node:assert/strict';
import {before, after, beforeEach, test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import {graphql, type GraphQLSchema} from 'graphql';
import {applyMiddleware} from 'graphql-middleware';
import permissions from '../../permissions.js';
import userChildIdentityMiddleware from '../../middleware/userChildIdentityMiddleware.js';
import type {Driver} from 'neo4j-driver';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {startNeo4j, stopNeo4j, resetDatabase} from './neo4jHarness.js';

// v7 (campaign #284): the two owned-write mutations the frontend slice needs
// once v7 removed to-one connect/disconnect and nested relationship create.
let driver: Driver;
let schema: GraphQLSchema;
let publicSchema: GraphQLSchema;
before(async () => {
  driver = await startNeo4j();
  const app = getCustomResolvers(driver);
  const neo = new Neo4jGraphQL({driver, typeDefs, resolvers: app.resolvers, features: {filters: {String: {MATCHES: true}}}});
  schema = await neo.getSchema();
  registerGeneratedSchema(driver, schema);
  publicSchema = applyMiddleware(schema, userChildIdentityMiddleware, permissions);
}, {timeout: 240000});
beforeEach(async () => resetDatabase(driver));
after(async () => stopNeo4j());

const SOFT_DELETE = `mutation ($where: CommentWhere!) {
  softDeleteComment(where: $where) {
    comments { id text CommentAuthor { ... on User { username } } }
  }
}`;

test('softDeleteComment anonymizes text and removes the author edge', async () => {
  await driver.executeQuery(
    `CREATE (u:User {username:'alice', createdAt: datetime()}),
            (c:Comment {id:'c1', text:'original', isRootComment:true, createdAt: datetime()})
     CREATE (u)-[:AUTHORED_COMMENT]->(c)`
  );
  const result = await graphql({schema, source: SOFT_DELETE, variableValues: {where: {id: {eq: 'c1'}}}, contextValue: {}});
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  const comment = (result.data as any).softDeleteComment.comments[0];
  assert.equal(comment.text, '[Deleted]');
  assert.equal(comment.CommentAuthor, null, 'author projection should be null after disconnect');
  const edge = (await driver.executeQuery(
    `MATCH (c:Comment {id:'c1'}) RETURN EXISTS { ()-[:AUTHORED_COMMENT]->(c) } AS authored`
  )).records[0].get('authored');
  assert.equal(edge, false, 'AUTHORED_COMMENT edge removed');
});

const ADD_ACTIVITY = `mutation (
  $where: IssueWhere!, $actionType: String!, $actionDescription: String!,
  $displayName: String, $username: String, $commentText: String,
  $channelUniqueName: String, $flaggedServerRuleViolation: Boolean
) {
  addIssueActivityFeedItem(
    where: $where, actionType: $actionType, actionDescription: $actionDescription,
    displayName: $displayName, username: $username, commentText: $commentText,
    channelUniqueName: $channelUniqueName, flaggedServerRuleViolation: $flaggedServerRuleViolation
  ) {
    issues {
      id
      flaggedServerRuleViolation
      ActivityFeed {
        actionType
        actionDescription
        ModerationProfile { displayName }
        User { username }
        Comment { id text CommentAuthor { ... on User { username } ... on ModerationProfile { displayName } } }
      }
    }
  }
}`;

test('addIssueActivityFeedItem (action only) connects a ModerationProfile actor', async () => {
  await driver.executeQuery(
    `CREATE (:Issue {id:'i1', issueNumber:1, createdAt: datetime()}),
            (:ModerationProfile {displayName:'mod-mary', createdAt: datetime()})`
  );
  const result = await graphql({schema, source: ADD_ACTIVITY, contextValue: {}, variableValues: {
    where: {id: {eq: 'i1'}}, actionType: 'report', actionDescription: 'flagged a rule violation', displayName: 'mod-mary',
  }});
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  const issue = (result.data as any).addIssueActivityFeedItem.issues[0];
  assert.equal(issue.ActivityFeed.length, 1);
  assert.equal(issue.ActivityFeed[0].actionType, 'report');
  assert.equal(issue.ActivityFeed[0].ModerationProfile.displayName, 'mod-mary');
  assert.equal(issue.ActivityFeed[0].User, null);
  assert.equal(issue.ActivityFeed[0].Comment, null);
});

test('addIssueActivityFeedItem with a mod-authored comment wires comment + flag', async () => {
  await driver.executeQuery(
    `CREATE (:Issue {id:'i2', issueNumber:2, createdAt: datetime()}),
            (:ModerationProfile {displayName:'mod-mary', createdAt: datetime()}),
            (:Channel {uniqueName:'forum'})`
  );
  const result = await graphql({schema, source: ADD_ACTIVITY, contextValue: {}, variableValues: {
    where: {id: {eq: 'i2'}}, actionType: 'report', actionDescription: 'reported', displayName: 'mod-mary',
    commentText: 'why this was reported', channelUniqueName: 'forum', flaggedServerRuleViolation: true,
  }});
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  const issue = (result.data as any).addIssueActivityFeedItem.issues[0];
  assert.equal(issue.flaggedServerRuleViolation, true);
  const action = issue.ActivityFeed[0];
  assert.equal(action.Comment.text, 'why this was reported');
  assert.equal(action.Comment.CommentAuthor.displayName, 'mod-mary');
  // Comment is wired to the channel and the issue via owned edges.
  const edges = (await driver.executeQuery(
    `MATCH (c:Comment {id: $id}) RETURN
       EXISTS { (:Channel {uniqueName:'forum'})-[:HAS_COMMENT]->(c) } AS inChannel,
       EXISTS { (c)-[:ACTIVITY_ON_ISSUE]->(:Issue {id:'i2'}) } AS onIssue,
       EXISTS { (:ModerationAction)-[:MODERATED_COMMENT]->(c) } AS moderated`,
    {id: action.Comment.id}
  )).records[0];
  assert.equal(edges.get('inChannel'), true, 'HAS_COMMENT to channel');
  assert.equal(edges.get('onIssue'), true, 'ACTIVITY_ON_ISSUE to issue');
  assert.equal(edges.get('moderated'), true, 'MODERATED_COMMENT from action');
});

test('addIssueActivityFeedItem with a user-authored comment uses the User actor', async () => {
  await driver.executeQuery(
    `CREATE (:Issue {id:'i3', issueNumber:3, createdAt: datetime()}),
            (:User {username:'bob', createdAt: datetime()}),
            (:Channel {uniqueName:'forum'})`
  );
  const result = await graphql({schema, source: ADD_ACTIVITY, contextValue: {}, variableValues: {
    where: {id: {eq: 'i3'}}, actionType: 'report', actionDescription: 'reported', username: 'bob',
    commentText: 'user report note', channelUniqueName: 'forum', flaggedServerRuleViolation: false,
  }});
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  const action = (result.data as any).addIssueActivityFeedItem.issues[0].ActivityFeed[0];
  assert.equal(action.User.username, 'bob');
  assert.equal(action.ModerationProfile, null);
  assert.equal(action.Comment.CommentAuthor.username, 'bob');
});

const seedSelectionIssue = () => driver.executeQuery(`
  CREATE (i:Issue {id:'selection',title:'Visible title',isOpen:true,issueNumber:1,createdAt:datetime()}),
    (u:User {username:'reporter',createdAt:datetime()}),
    (:Channel {uniqueName:'forum',createdAt:datetime()}),
    (:ModerationProfile {displayName:'mod',createdAt:datetime()})
  CREATE (i)-[:AUTHORED_ISSUE]->(u)`);
const selectionMutation = (selection: string, fragments = '', variables = '') => `
  mutation Selection${variables} {
    action:addIssueActivityFeedItem(where:{id:{eq:"selection"}},actionType:"report",
      actionDescription:"selection witness",displayName:"mod",commentText:"note",channelUniqueName:"forum") {
      ${selection}
    }
  } ${fragments}`;
const assertOneWrite = async () => {
  const counts = (await driver.executeQuery(`MATCH (i:Issue {id:'selection'})
    OPTIONAL MATCH (i)-[:ACTIVITY_ON_ISSUE]->(a:ModerationAction)
    OPTIONAL MATCH (a)-[:MODERATED_COMMENT]->(c:Comment)
    RETURN count(DISTINCT a) AS actions,count(DISTINCT c) AS comments`)).records[0];
  assert.equal(counts.get('actions').toNumber(), 1);
  assert.equal(counts.get('comments').toNumber(), 1);
};
for (const [name, selection, fragments] of [
  ['alias', 'items:issues{id title}', ''],
  ['fragment', '...Payload', 'fragment Payload on IssueActivityFeedItemResponse {items:issues{id title}}'],
  ['inline fragment', '... on IssueActivityFeedItemResponse {items:issues{id title}}', ''],
  ['merged selections', 'items:issues{id} items:issues{title}', ''],
]) {
  test(`activity refetch preserves ${name} selections and creates one action/comment`, async () => {
    await seedSelectionIssue();
    const result = await graphql({schema, source: selectionMutation(selection, fragments), contextValue: {}});
    assert.equal(result.errors, undefined, JSON.stringify(result.errors));
    assert.deepEqual(JSON.parse(JSON.stringify(result.data)), {action:{items:[{id:'selection',title:'Visible title'}]}});
    await assertOneWrite();
  });
}

for (const show of [true, false]) {
  test(`activity payload aliases forward directive and argument variables (show=${show})`, async () => {
    await seedSelectionIssue();
    const source = selectionMutation(`
      first:issues { id ...Fields @include(if:$show) }
      second:issues { title feed:ActivityFeed(limit:$limit) { kind:actionType Comment { text } } }
      omitted:issues @skip(if:true) { title }
    `, 'fragment Fields on Issue { label:title @skip(if:$hide) }', '($show:Boolean!=true,$hide:Boolean!=false,$limit:Int!=1)');
    const result = await graphql({schema, source, variableValues:{show}, contextValue:{}});
    assert.equal(result.errors, undefined, JSON.stringify(result.errors));
    assert.deepEqual(JSON.parse(JSON.stringify(result.data)), {action:{
      first:[{id:'selection',...(show ? {label:'Visible title'} : {})}],
      second:[{title:'Visible title',feed:[{kind:'report',Comment:{text:'note'}}]}],
    }});
    await assertOneWrite();
  });
}

test('activity write executes once when all payload fields are skipped', async () => {
  await seedSelectionIssue();
  const result = await graphql({schema,source:selectionMutation('issues @skip(if:true) {id}'),contextValue:{}});
  assert.equal(result.errors, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)), {action:{}});
  await assertOneWrite();
});

const requestContext = (username?: string) => ({
  driver, req:{headers:{},body:{},isMutation:true},
  ...(username ? {user:{username,email:null,email_verified:true,data:{username,ModerationProfile:{displayName:username === "reporter" ? "mod" : "other"}},dateOfBirth:null}} : {}),
});
test('Shield rejects anonymous and unrelated callers before activity side effects', async () => {
  await seedSelectionIssue();
  for (const username of [undefined, 'unrelated']) {
    const result = await graphql({schema:publicSchema,
      source:selectionMutation('...Payload','fragment Payload on IssueActivityFeedItemResponse {items:issues{id title}}'),
      contextValue:requestContext(username)});
    assert.ok(result.errors?.length);
    assert.equal(result.data, null);
  }
  const counts = (await driver.executeQuery('MATCH (n) WHERE n:ModerationAction OR n:Comment RETURN count(n) AS count')).records[0];
  assert.equal(counts.get('count').toNumber(), 0);
});
test('authorized activity payload retains Shield privacy on nested aliased identities', async () => {
  await seedSelectionIssue();
  await driver.executeQuery("MATCH(m:ModerationProfile {displayName:'mod'}),(u:User {username:'reporter'}) CREATE (u)-[:MODERATION_PROFILE]->(m)");
  const result = await graphql({schema:publicSchema,source:selectionMutation(`items:issues {
    id title ActivityFeed { ModerationProfile { displayName privateIdentity:User { username } } }
  }`),contextValue:requestContext('reporter')});
  assert.ok(result.errors?.some(error => error.path?.includes('privateIdentity')), JSON.stringify(result));
  const issue = (result.data as any).action.items[0];
  assert.equal(issue.title, 'Visible title');
  assert.equal(issue.ActivityFeed[0].ModerationProfile.privateIdentity, null);
  await assertOneWrite();
});

test('activity response reads only requested fields and preserves nullable error paths', async () => {
  await seedSelectionIssue();
  await driver.executeQuery("MATCH(i:Issue {id:'selection'}) SET i.title=['malformed']");
  const omitted = await graphql({schema, source:selectionMutation('items:issues{id}'), contextValue:{}});
  assert.equal(omitted.errors, undefined);
  await assertOneWrite();
  const selected = await graphql({schema, source:selectionMutation('items:issues{id bad:title}'), contextValue:{}});
  assert.ok(selected.errors?.some(error => JSON.stringify(error.path) === JSON.stringify(['action','items',0,'bad'])), JSON.stringify(selected));
  assert.deepEqual(JSON.parse(JSON.stringify(selected.data)), {action:{items:[{id:'selection',bad:null}]}});
});
test('missing issue returns an empty aliased payload without creating orphan actions', async () => {
  const result = await graphql({schema,source:selectionMutation('items:issues{id title}'),contextValue:{}});
  assert.equal(result.errors, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)), {action:{items:[]}});
  const count = (await driver.executeQuery('MATCH(n) RETURN count(n) AS count')).records[0].get('count').toNumber();
  assert.equal(count, 0);
});

test('unaliased activity selection forwards directive variables without a post-commit validation error', async () => {
  await seedSelectionIssue();
  const result = await graphql({schema,
    source:selectionMutation('issues{id title @include(if:$show)}', '', '($show:Boolean!)'),
    variableValues:{show:true}, contextValue:{}});
  await assertOneWrite();
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)), {action:{issues:[{id:'selection',title:'Visible title'}]}});
});

test('typed activity delegation retains post-commit read errors and the requested payload path',async()=>{
 await seedSelectionIssue();
 const field=schema.getQueryType()!.getFields().issues;
 const original=field.resolve;let reads=0;
 field.resolve=(_parent,args,context)=>{
  reads++;assert.deepEqual(args.where,{id:{eq:'selection'}});
  assert.deepEqual(context,{jwt:{mayAccessSensitiveContent:true}});
  throw new Error('delegated read unavailable');
 };
 try{
  const result=await graphql({schema,source:selectionMutation('items:issues{id}'),contextValue:{}});
  assert.equal(reads,1);assert.equal(result.data,null);
  assert.ok(result.errors?.some(error=>error.message==='delegated read unavailable'&&JSON.stringify(error.path)===JSON.stringify(['action','items'])));
  await assertOneWrite();
 }finally{field.resolve=original;}
});

test('a skipped delegated payload does not read even when its source would fail',async()=>{
 await seedSelectionIssue();
 const field=schema.getQueryType()!.getFields().issues;const original=field.resolve;let reads=0;
 field.resolve=()=>{reads++;throw new Error('must remain lazy');};
 try{
  const result=await graphql({schema,source:selectionMutation('items:issues @skip(if:true){id}'),contextValue:{}});
  assert.equal(result.errors,undefined);assert.equal(reads,0);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)),{action:{}});await assertOneWrite();
 }finally{field.resolve=original;}
});

test('delegated issue author preserves owner child identity without username selection',async()=>{
 await seedSelectionIssue();
 await driver.executeQuery("MATCH(u:User{username:'reporter'}) CREATE(:Email{address:'reporter@activity.test'})-[:HAS_EMAIL]->(u)");
 const result=await graphql({schema:publicSchema,source:selectionMutation('items:issues{Author{... on User{mail:Email{address}}}}'),contextValue:requestContext('reporter')});
 await assertOneWrite();
 assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 assert.deepEqual(JSON.parse(JSON.stringify(result.data)),{action:{items:[{Author:{mail:{address:'reporter@activity.test'}}}]}});
});
test('delegated activity comment author preserves moderator type without displayName selection',async()=>{
 await seedSelectionIssue();
 await driver.executeQuery("MATCH(m:ModerationProfile{displayName:'mod'}) SET m.createdAt=datetime('2026-01-01T00:00:00Z')");
 const result=await graphql({schema:publicSchema,source:selectionMutation('items:issues{ActivityFeed{Comment{CommentAuthor{__typename ... on ModerationProfile{createdAt}}}}}'),contextValue:requestContext('reporter')});
 await assertOneWrite();
 assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 assert.deepEqual(JSON.parse(JSON.stringify(result.data)),{action:{items:[{ActivityFeed:[{Comment:{CommentAuthor:{__typename:'ModerationProfile',createdAt:'2026-01-01T00:00:00.000Z'}}}]}]}});
});
test('delegated private identity remains raw rather than authorizing a scalar-coerced username',async()=>{
 await seedSelectionIssue();
 await driver.executeQuery(`MATCH(i:Issue{id:'selection'})-[r:AUTHORED_ISSUE]->() DELETE r
  CREATE(actor:User{username:'17',createdAt:datetime()}),(target:User{username:17,createdAt:datetime()}),
  (i)-[:AUTHORED_ISSUE]->(actor),(i)-[:TARGETS_USER]->(target),
  (:Email{address:'private@activity.test'})-[:HAS_EMAIL]->(target)`);
 const source=selectionMutation('items:issues{id TargetUser{mail:Email{address}}}').replace('displayName:"mod"','username:"17"');
 const result=await graphql({schema:publicSchema,source,contextValue:requestContext('17')});
 await assertOneWrite();
 assert.deepEqual(result.errors?.map(error=>error.path),[['action','items',0,'TargetUser','mail']],JSON.stringify(result));
 assert.deepEqual(JSON.parse(JSON.stringify(result.data)),{action:{items:[{id:'selection',TargetUser:{mail:null}}]}});
});
for(const show of [true,false])test(`delegated author metadata preserves aliases, fragments and private-field include=${show}`,async()=>{
 await seedSelectionIssue();
 await driver.executeQuery("MATCH(u:User{username:'reporter'}) SET u.bio='public' CREATE(:Email{address:'reporter@activity.test'})-[:HAS_EMAIL]->(u)");
 const source=selectionMutation('one:issues{...Fields} two:issues{...Fields}', 'fragment Fields on Issue{who:Author{... on User{username:bio mail:Email @include(if:$show){address}}}}','($show:Boolean!=true)');
 const result=await graphql({schema:publicSchema,source,variableValues:{show},contextValue:requestContext('reporter')});
 assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 const issue={who:{username:'public',...(show?{mail:{address:'reporter@activity.test'}}:{})}};
 assert.deepEqual(JSON.parse(JSON.stringify(result.data)),{action:{one:[issue],two:[issue]}});
 await assertOneWrite();
});
test('delegated moderator branch retains nullable displayName without exposing the human account',async()=>{
 await seedSelectionIssue();
 await driver.executeQuery("MATCH(m:ModerationProfile{displayName:'mod'}),(u:User{username:'reporter'}) SET m.createdAt=datetime('2026-01-01T00:00:00Z') CREATE(u)-[:MODERATION_PROFILE]->(m)");
 const field=schema.getQueryType()!.getFields().issues,original=field.resolve!;
 field.resolve=async(parent,args,context,info)=>{
  await driver.executeQuery("MATCH(m:ModerationProfile{displayName:'mod'}) REMOVE m.displayName");
  return original(parent,args,context,info);
 };
 try{
  const result=await graphql({schema:publicSchema,source:selectionMutation('items:issues{ActivityFeed{Comment{CommentAuthor{__typename ... on ModerationProfile{displayName createdAt hidden:User{username}}}}}}'),contextValue:requestContext('reporter')});
  await assertOneWrite();
  assert.deepEqual(result.errors?.map(error=>error.path),[['action','items',0,'ActivityFeed',0,'Comment','CommentAuthor','hidden']],JSON.stringify(result));
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)),{action:{items:[{ActivityFeed:[{Comment:{CommentAuthor:{__typename:'ModerationProfile',displayName:null,createdAt:'2026-01-01T00:00:00.000Z',hidden:null}}}]}]}});
 }finally{field.resolve=original;}
});

test('delegated activity User actor retains selected owner children without public username',async()=>{
 await seedSelectionIssue();
 await driver.executeQuery("MATCH(u:User{username:'reporter'}) CREATE(:Email{address:'reporter@activity.test'})-[:HAS_EMAIL]->(u)");
 const source=selectionMutation('items:issues{ActivityFeed{User{mail:Email{address}}}}').replace('displayName:"mod"','username:"reporter"');
 const result=await graphql({schema:publicSchema,source,contextValue:requestContext('reporter')});
 await assertOneWrite();
 assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 assert.deepEqual(JSON.parse(JSON.stringify(result.data)),{action:{items:[{ActivityFeed:[{User:{mail:{address:'reporter@activity.test'}}}]}]}});
});
