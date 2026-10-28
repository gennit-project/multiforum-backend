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
before(async () => {
  driver = await startNeo4j();
  const app = getCustomResolvers(driver);
  const neo = new Neo4jGraphQL({ driver, typeDefs, resolvers: app.resolvers,
    features: { filters: { String: { MATCHES: true } }, subscriptions: true } });
  const generated = await neo.getSchema();
  registerGeneratedSchema(driver, generated);
  schema = applyMiddleware(generated, permissions);
}, { timeout: 240000 });
after(async () => stopNeo4j());
beforeEach(async () => {
  await resetDatabase(driver);
  await driver.executeQuery(`
    CREATE (ch:Channel {uniqueName:'cats', displayName:'Cats'})
    CREATE (u:User {username:'alice',createdAt:datetime(),discussionKarma:0,commentKarma:0})
    CREATE (d:Discussion {id:'d1',title:'Visible discussion',body:'Hello',createdAt:datetime(),hasSensitiveContent:false})
    CREATE (dc:DiscussionChannel {id:'dc1',discussionId:'d1',channelUniqueName:'cats',createdAt:datetime(),weightedVotesCount:1})
    CREATE (u)-[:POSTED_DISCUSSION]->(d), (u)-[:UPVOTED_DISCUSSION]->(dc)
    CREATE (dc)-[:POSTED_IN_CHANNEL]->(d), (dc)-[:POSTED_IN_CHANNEL]->(ch)
    CREATE (dc)-[:CONTAINS_COMMENT]->(:Comment {id:'normal',isFeedbackComment:false})
    CREATE (dc)-[:CONTAINS_COMMENT]->(:Comment {id:'legacy'})
    CREATE (dc)-[:CONTAINS_COMMENT]->(feedback:Comment {id:'feedback',isFeedbackComment:true})
    CREATE (feedback)-[:HAS_FEEDBACK_COMMENT]->(d)
  `);
});
const execute = (source: string, variableValues = {}, mayAccessSensitiveContent?: boolean) => graphql({ schema, source, variableValues,
  contextValue: { driver, mayAccessSensitiveContent, req: { headers: {}, body: {} } } });
// Preserve the bounded custom resolver's count semantics: legacy comments with
// no isFeedbackComment flag count as normal comments, including in detail.
const listQuery = readFileSync(new URL('../fixtures/siteWideDiscussionList.graphql', import.meta.url), 'utf8');
const variables = { searchInput:'', selectedChannels:[], selectedTags:[], showArchived:false, options:{sort:'new',limit:10} };

test('nonempty site-wide list resolves the actual frontend connection selection', async () => {
  const minimal = await execute('{ getSiteWideDiscussionList(showArchived:false, options:{sort:new}) { discussions { id } } }');
  assert.equal(minimal.errors, undefined);
  assert.equal((minimal.data as any).getSiteWideDiscussionList.discussions[0].id, 'd1');
  const result = await execute(listQuery, variables);
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  const list = (result.data as any).getSiteWideDiscussionList;
  assert.equal(list.aggregateDiscussionCount, 1);
  assert.equal(list.discussions[0].DiscussionChannels[0].CommentsConnection.aggregate.count.nodes, 2);
});

test('zero comments and excluded discussions retain the empty and visibility behavior', async () => {
  await driver.executeQuery('MATCH (c:Comment) DETACH DELETE c');
  const result = await execute(listQuery, variables);
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  assert.equal((result.data as any).getSiteWideDiscussionList.discussions[0].DiscussionChannels[0].CommentsConnection.aggregate.count.nodes, 0);
  await driver.executeQuery('MATCH (dc:DiscussionChannel) SET dc.archived = true');
  const hidden = await execute(listQuery, variables);
  assert.equal(hidden.errors, undefined);
  assert.deepEqual((hidden.data as any).getSiteWideDiscussionList.discussions, []);
});

test('discussion and download detail connection counts survive GraphQL serialization', async () => {
  const result = await execute(`{ getDiscussionDetail(discussionId:"d1",channelUniqueName:"cats") {
    id FeedbackCommentsConnection { aggregate { count { nodes } } }
    DiscussionChannels { id
      CommentsConnection(where:{node:{isFeedbackComment:{eq:false}}}) { aggregate { count { nodes } } }
      UpvotedByUsersConnection { aggregate { count { nodes } } }
    }
  } }`);
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  const detail = (result.data as any).getDiscussionDetail[0];
  assert.equal(detail.FeedbackCommentsConnection.aggregate.count.nodes, 1);
  assert.equal(detail.DiscussionChannels[0].CommentsConnection.aggregate.count.nodes, 2);
  assert.equal(detail.DiscussionChannels[0].UpvotedByUsersConnection.aggregate.count.nodes, 1);
});


test('sensitive discussions remain hidden from ineligible readers', async () => {
  await driver.executeQuery('MATCH (d:Discussion) SET d.hasSensitiveContent = true');
  const list = await execute(listQuery, variables, false);
  assert.equal(list.errors, undefined, JSON.stringify(list.errors));
  assert.deepEqual((list.data as any).getSiteWideDiscussionList.discussions, []);
  const detail = await execute('{ getDiscussionDetail(discussionId:"d1",channelUniqueName:"cats") { id } }', {}, false);
  assert.equal(detail.errors, undefined, JSON.stringify(detail.errors));
  assert.deepEqual((detail.data as any).getDiscussionDetail, []);
});

test('channel lists retain their explicit aggregate contract', async () => {
  const result = await execute(`{ getDiscussionsInChannel(channelUniqueName:"cats",showArchived:false,options:{sort:new}) {
    discussionChannels { id CommentsAggregate { count } UpvotedByUsersAggregate { count } }
  } }`);
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  const channel = (result.data as any).getDiscussionsInChannel.discussionChannels[0];
  assert.equal(channel.CommentsAggregate.count, 2);
  assert.equal(channel.UpvotedByUsersAggregate.count, 1);
});
