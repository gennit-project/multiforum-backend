import assert from 'node:assert/strict';
import {before, after, beforeEach, test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import {graphql, type GraphQLSchema} from 'graphql';
import type {Driver} from 'neo4j-driver';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {startNeo4j, stopNeo4j, resetDatabase} from './neo4jHarness.js';

// v7 (campaign #284): the two owned-write mutations the frontend slice needs
// once v7 removed to-one connect/disconnect and nested relationship create.
let driver: Driver;
let schema: GraphQLSchema;
before(async () => {
  driver = await startNeo4j();
  const app = getCustomResolvers(driver);
  const neo = new Neo4jGraphQL({driver, typeDefs, resolvers: app.resolvers, features: {filters: {String: {MATCHES: true}}}});
  schema = await neo.getSchema();
  registerGeneratedSchema(driver, schema);
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
