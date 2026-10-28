import assert from 'node:assert/strict';
import {before, after, beforeEach, test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import {graphql, type GraphQLSchema} from 'graphql';
import type {Driver} from 'neo4j-driver';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {startNeo4j, stopNeo4j, resetDatabase} from './neo4jHarness.js';

// v7 (campaign #284): the owned-write comment mutation must wire every to-one
// and to-many connect the frontend sends, since the generated create can no
// longer carry them. These lock the full edge contract, including the author
// self-upvote (UPVOTED_COMMENT) and notification auto-subscribe
// (SUBSCRIBED_TO_NOTIFICATIONS) to-many connects.
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

const CREATE = `mutation ($input: [OwnedCommentCreateInput!]!) {
  createCommentWithOwnedConnections(input: $input) { comments { id text isRootComment } }
}`;

test('root comment owns author, container, upvote and subscribe edges', async () => {
  await driver.executeQuery(
    `CREATE (:User {username:'alice', createdAt: datetime()}),
            (d:Discussion {id:'d', createdAt: datetime()}),
            (dc:DiscussionChannel {id:'dc', channelUniqueName:'forum'})
     CREATE (dc)-[:POSTED_IN_CHANNEL]->(d)`
  );
  const input = [{
    text: 'hello',
    isRootComment: true,
    CommentAuthor: {User: {connect: {where: {node: {username: 'alice'}}}}},
    DiscussionChannel: {connect: {where: {node: {id: 'dc'}}}},
    UpvotedByUsers: {connect: [{where: {node: {username: 'alice'}}}]},
    SubscribedToNotifications: {connect: [{where: {node: {username: 'alice'}}}]},
  }];
  const result = await graphql({schema, source: CREATE, variableValues: {input}, contextValue: {}});
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  const comments = (result.data as any).createCommentWithOwnedConnections.comments;
  assert.equal(comments.length, 1);
  assert.equal(comments[0].text, 'hello');
  const edges = (await driver.executeQuery(
    `MATCH (c:Comment {id: $id}) RETURN
       EXISTS { (:User {username:'alice'})-[:AUTHORED_COMMENT]->(c) } AS authored,
       EXISTS { (:DiscussionChannel {id:'dc'})-[:CONTAINS_COMMENT]->(c) } AS contained,
       EXISTS { (:User {username:'alice'})-[:UPVOTED_COMMENT]->(c) } AS upvoted,
       EXISTS { (:User {username:'alice'})-[:SUBSCRIBED_TO_NOTIFICATIONS]->(c) } AS subscribed`,
    {id: comments[0].id}
  )).records[0];
  assert.equal(edges.get('authored'), true, 'AUTHORED_COMMENT');
  assert.equal(edges.get('contained'), true, 'CONTAINS_COMMENT');
  assert.equal(edges.get('upvoted'), true, 'UPVOTED_COMMENT (author self-upvote)');
  assert.equal(edges.get('subscribed'), true, 'SUBSCRIBED_TO_NOTIFICATIONS (auto-subscribe)');
});

test('reply owns IS_REPLY_TO to its parent', async () => {
  await driver.executeQuery(
    `CREATE (:User {username:'alice', createdAt: datetime()}),
            (:Comment {id:'parent', text:'p', isRootComment:true, createdAt: datetime()})`
  );
  const input = [{
    text: 'a reply',
    isRootComment: false,
    ParentComment: {connect: {where: {node: {id: 'parent'}}}},
    CommentAuthor: {User: {connect: {where: {node: {username: 'alice'}}}}},
  }];
  const result = await graphql({schema, source: CREATE, variableValues: {input}, contextValue: {}});
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  const id = (result.data as any).createCommentWithOwnedConnections.comments[0].id;
  const replied = (await driver.executeQuery(
    `MATCH (c:Comment {id: $id}) RETURN EXISTS { (c)-[:IS_REPLY_TO]->(:Comment {id:'parent'}) } AS replied`,
    {id}
  )).records[0].get('replied');
  assert.equal(replied, true);
});

test('a missing connect endpoint is a no-op, not an error', async () => {
  await driver.executeQuery(`CREATE (:User {username:'alice', createdAt: datetime()})`);
  const input = [{
    text: 'orphan',
    isRootComment: true,
    CommentAuthor: {User: {connect: {where: {node: {username: 'alice'}}}}},
    DiscussionChannel: {connect: {where: {node: {id: 'does-not-exist'}}}},
  }];
  const result = await graphql({schema, source: CREATE, variableValues: {input}, contextValue: {}});
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  const id = (result.data as any).createCommentWithOwnedConnections.comments[0].id;
  const row = (await driver.executeQuery(
    `MATCH (c:Comment {id: $id}) RETURN
       EXISTS { (:User {username:'alice'})-[:AUTHORED_COMMENT]->(c) } AS authored,
       EXISTS { (:DiscussionChannel)-[:CONTAINS_COMMENT]->(c) } AS contained`,
    {id}
  )).records[0];
  assert.equal(row.get('authored'), true);
  assert.equal(row.get('contained'), false);
});
