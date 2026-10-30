import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { graphql, type GraphQLSchema } from "graphql";
import { applyMiddleware } from "graphql-middleware";
import type { Driver } from "neo4j-driver";
import getCustomResolvers from "../helpers/getTestResolvers.js";
import typeDefs from "../../typeDefs.js";
import permissions from "../../permissions.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";

let driver: Driver;
let schema: GraphQLSchema;
let generatedSchema: GraphQLSchema;
before(async () => {
  driver = await startNeo4j();
  const app = getCustomResolvers(driver);
  const neo = new Neo4jGraphQL({ driver, typeDefs, resolvers: app.resolvers,
    features: { filters: { String: { MATCHES: true } }, subscriptions: true } });
  const generated = await neo.getSchema();
  generatedSchema = generated;
  registerGeneratedSchema(driver, generated);
  schema = applyMiddleware(generated, permissions);
}, { timeout: 240000 });
after(async () => stopNeo4j());
beforeEach(async () => {
  await resetDatabase(driver);
  await driver.executeQuery(`
    CREATE (ch:Channel {uniqueName:'cats', displayName:'Cats'})
    CREATE (u:User {username:'alice',createdAt:datetime(),discussionKarma:0,commentKarma:0})
    CREATE (d:Discussion {id:'d1',title:'Discussion',body:'Hello',createdAt:datetime(),hasSensitiveContent:false})
    CREATE (dc:DiscussionChannel {id:'dc1',discussionId:'d1',channelUniqueName:'cats',createdAt:datetime(),weightedVotesCount:1})
    CREATE (u)-[:POSTED_DISCUSSION]->(d), (u)-[:UPVOTED_DISCUSSION]->(dc)
    CREATE (dc)-[:POSTED_IN_CHANNEL]->(d), (dc)-[:POSTED_IN_CHANNEL]->(ch)
    CREATE (root:Comment {id:'root',text:'Root',isRootComment:true,isFeedbackComment:false,createdAt:datetime(),weightedVotesCount:1})
    CREATE (reply:Comment {id:'reply',text:'Reply',isRootComment:false,isFeedbackComment:false,createdAt:datetime(),weightedVotesCount:1})
    CREATE (leaf:Comment {id:'leaf',text:'Leaf',isRootComment:false,createdAt:datetime()})
    CREATE (reply)-[:IS_REPLY_TO]->(root), (leaf)-[:IS_REPLY_TO]->(reply)
    CREATE (dc)-[:CONTAINS_COMMENT]->(root), (dc)-[:CONTAINS_COMMENT]->(reply)
    CREATE (dc)-[:CONTAINS_COMMENT]->(:Comment {id:'legacy'})
    CREATE (dc)-[:CONTAINS_COMMENT]->(:Comment {id:'feedback',isFeedbackComment:true})
    CREATE (u)-[:AUTHORED_COMMENT]->(root), (u)-[:AUTHORED_COMMENT]->(reply)
    CREATE (u)-[:UPVOTED_COMMENT]->(root), (u)-[:UPVOTED_COMMENT]->(reply)
    CREATE (e:Event {id:'e1',title:'Event',createdAt:datetime(),startTime:datetime(),endTime:datetime(),canceled:false})
    CREATE (e)-[:HAS_COMMENT]->(root), (e)-[:HAS_COMMENT]->(reply)
  `);
});
const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}.graphql`, import.meta.url), 'utf8');
const execute = (source: string, variableValues = {}) => graphql({ schema, source, variableValues,
  contextValue: { driver, req: { headers: {}, body: {} } } });
const discussionVariables = {modName:null,discussionId:'d1',channelUniqueName:'cats',offset:0,limit:1,sort:'new'};
const counts = (comment: Record<string, any>) => ({
  votes: comment.UpvotedByUsersConnection.aggregate.count.nodes,
  replies: comment.ChildCommentsConnection.aggregate.count.nodes,
});

test('actual discussion comment query serializes channel counts, aliases, and comment counts', async () => {
  const result = await execute(fixture('discussionCommentSection'), discussionVariables);
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  const section = (result.data as any).getCommentSection;
  assert.deepEqual({
    votes: section.DiscussionChannel.UpvotedByUsersConnection.aggregate.count.nodes,
    comments: section.DiscussionChannel.CommentsConnection.aggregate.count.nodes,
    roots: section.DiscussionChannel.RootCommentsConnection.aggregate.count.nodes,
    pageLength: section.Comments.length,
    comment: counts(section.Comments[0]),
  }, {votes:1,comments:3,roots:1,pageLength:1,comment:{votes:1,replies:1}});
});

test('actual reply query serializes votes and nested reply counts with pagination', async () => {
  const result = await execute(fixture('commentReplies'), {commentId:'root',modName:null,offset:0,limit:1,sort:'new'});
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  const replies = (result.data as any).getCommentReplies;
  assert.deepEqual({total:replies.aggregateChildCommentCount,comment:counts(replies.ChildComments[0])},
    {total:1,comment:{votes:1,replies:1}});
});

test('actual event comment query serializes votes and child counts', async () => {
  const result = await execute(fixture('eventCommentSection'), {eventId:'e1',offset:0,limit:1,sort:'new'});
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  assert.deepEqual(counts((result.data as any).getEventComments.Comments[0]), {votes:1,replies:1});
});

test('comments without votes or replies return zero connections', async () => {
  await driver.executeQuery(`MATCH (:User)-[vote:UPVOTED_COMMENT]->() DELETE vote`);
  await driver.executeQuery(`MATCH (:Comment)-[reply:IS_REPLY_TO]->() DELETE reply`);
  const result = await execute(fixture('discussionCommentSection'), discussionVariables);
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  assert.deepEqual(counts((result.data as any).getCommentSection.Comments[0]), {votes:0,replies:0});
});

test('empty discussion sections still serialize zero channel counts', async () => {
  await driver.executeQuery('MATCH (c:Comment) DETACH DELETE c');
  await driver.executeQuery('MATCH (:User)-[vote:UPVOTED_DISCUSSION]->() DELETE vote');
  const result = await execute(fixture('discussionCommentSection'), discussionVariables);
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  const section = (result.data as any).getCommentSection;
  assert.deepEqual({comments:section.Comments,
    count:section.DiscussionChannel.CommentsConnection.aggregate.count.nodes,
    roots:section.DiscussionChannel.RootCommentsConnection.aggregate.count.nodes,
    votes:section.DiscussionChannel.UpvotedByUsersConnection.aggregate.count.nodes,
  }, {comments:[],count:0,roots:0,votes:0});
});

test('reply leaves serialize zero vote and child connections', async () => {
  const result = await execute(fixture('commentReplies'), {commentId:'reply',modName:null,offset:0,limit:1,sort:'new'});
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  assert.deepEqual(counts((result.data as any).getCommentReplies.ChildComments[0]), {votes:0,replies:0});
});

test('event comments without votes or replies serialize zero connections', async () => {
  await driver.executeQuery('MATCH (:User)-[vote:UPVOTED_COMMENT]->() DELETE vote');
  await driver.executeQuery('MATCH (:Comment)-[reply:IS_REPLY_TO]->() DELETE reply');
  const result = await execute(fixture('eventCommentSection'), {eventId:'e1',offset:0,limit:1,sort:'new'});
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  assert.deepEqual(counts((result.data as any).getEventComments.Comments[0]), {votes:0,replies:0});
});

// Vote authorization has its own suites. Execute the real mutation and its
// response through the generated schema here to isolate the serialization
// contract, using only the disposable database.
for (const [up, down, field, undoField, id] of [
  ['UPVOTE_COMMENT','UNDO_UPVOTE_COMMENT','upvoteComment','undoUpvoteComment','root'],
  ['UPVOTE_DISCUSSION_CHANNEL','UNDO_UPVOTE_DISCUSSION_CHANNEL','upvoteDiscussionChannel','undoUpvoteDiscussionChannel','dc1'],
]) {
  test(`${field} and undo serialize the actual frontend vote response`, async () => {
    await driver.executeQuery("CREATE (:User {username:'voter',createdAt:datetime(),commentKarma:0,discussionKarma:0})");
    for (const [operation, key, expected] of [[up,field,2],[down,undoField,1]] as const) {
      const result = await graphql({schema:generatedSchema,source:fixture(operation!),
        variableValues:{id,username:'voter'},contextValue:{driver}});
      assert.equal(result.errors,undefined,JSON.stringify(result.errors));
      assert.equal((result.data as any)[key!].UpvotedByUsersConnection.aggregate.count.nodes,expected);
    }
  });
}

test('custom forum lists serialize discussion and event connection counts', async () => {
  await driver.executeQuery(`MATCH (ch:Channel {uniqueName:'cats'}), (e:Event {id:'e1'})
    SET e.endTime = datetime() + duration('P1D')
    CREATE (ec:EventChannel {id:'ec1',channelUniqueName:'cats',eventId:'e1'})
    CREATE (ec)-[:POSTED_IN_CHANNEL]->(ch), (ec)-[:POSTED_IN_CHANNEL]->(e)`);
  const result = await execute(`{getSortedChannels(countDownloads:false) {channels {
    uniqueName
    DiscussionChannelsConnection {aggregate {count {nodes}}}
    EventChannelsConnection {aggregate {count {nodes}}}
  }}}`);
  assert.equal(result.errors,undefined,JSON.stringify(result.errors));
  const channel = (result.data as any).getSortedChannels.channels[0];
  assert.deepEqual({discussions:channel.DiscussionChannelsConnection.aggregate.count.nodes,
    events:channel.EventChannelsConnection.aggregate.count.nodes}, {discussions:1,events:1});
});
