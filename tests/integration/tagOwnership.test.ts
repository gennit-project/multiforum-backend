import assert from 'node:assert/strict';
import {before, after, beforeEach, test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import {applyMiddleware} from 'graphql-middleware';
import {graphql, type GraphQLSchema} from 'graphql';
import type {Driver} from 'neo4j-driver';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {ownTags} from '../../services/persistence/tagOwnership.js';
import channelTagOwnershipMiddleware from '../../middleware/channelTagOwnershipMiddleware.js';
import {createDiscussionCreationRepository} from '../../services/persistence/discussionCreationRepository.js';
import {createDiscussionsFromInput} from '../../customResolvers/mutations/createDiscussionWithChannelConnections.js';
import {startNeo4j, stopNeo4j, resetDatabase} from './neo4jHarness.js';

// v7 (campaign #284): v7 dropped connectOrCreate from the generated *TagsFieldInput,
// so the create/update inputs can only carry `connect`. The backend strips the
// Tags field and owns HAS_TAG (MERGE by text) so a plain connect becomes
// create-if-missing again — uniformly across discussion/event/channel.
let driver: Driver;
let schema: GraphQLSchema;        // base generated schema (for custom resolvers)
let channelSchema: GraphQLSchema; // generated schema + the channel tag middleware
before(async () => {
  driver = await startNeo4j();
  const app = getCustomResolvers(driver);
  const neo = new Neo4jGraphQL({driver, typeDefs, resolvers: app.resolvers, features: {filters: {String: {MATCHES: true}}}});
  schema = await neo.getSchema();
  registerGeneratedSchema(driver, schema);
  channelSchema = applyMiddleware(schema, channelTagOwnershipMiddleware as never);
}, {timeout: 240000});
beforeEach(async () => resetDatabase(driver));
after(async () => stopNeo4j());

const run = (cypher: string, params: Record<string, unknown>) => driver.executeQuery(cypher, params);
const tagTextsOn = async (match: string): Promise<string[]> =>
  (await driver.executeQuery(
    `MATCH ${match}-[:HAS_TAG]->(t:Tag) RETURN t.text AS text ORDER BY text`
  )).records.map((r) => r.get('text') as string);
const tagNodeCount = async (text: string): Promise<number> =>
  (await driver.executeQuery(`MATCH (t:Tag {text: $text}) RETURN count(t) AS n`, {text}))
    .records[0].get('n').toNumber();

test('ownTags creates a missing tag and connects HAS_TAG', async () => {
  await run(`CREATE (:Discussion {id:'d', createdAt: datetime()})`, {});
  await ownTags(run, {label: 'Discussion', id: 'd'}, ['fresh']);
  assert.deepEqual(await tagTextsOn(`(:Discussion {id:'d'})`), ['fresh']);
});

test('ownTags reuses an existing tag without duplicating it', async () => {
  await run(`CREATE (:Discussion {id:'d', createdAt: datetime()}), (:Tag {text:'shared'})`, {});
  await ownTags(run, {label: 'Discussion', id: 'd'}, ['shared']);
  await ownTags(run, {label: 'Discussion', id: 'd'}, ['shared']); // idempotent
  assert.equal(await tagNodeCount('shared'), 1, 'no duplicate Tag node');
  assert.deepEqual(await tagTextsOn(`(:Discussion {id:'d'})`), ['shared']);
});

test('ownTags replace adds new and removes stale edges', async () => {
  await run(
    `CREATE (d:Discussion {id:'d', createdAt: datetime()}), (a:Tag {text:'a'}), (b:Tag {text:'b'})
     CREATE (d)-[:HAS_TAG]->(a) CREATE (d)-[:HAS_TAG]->(b)`,
    {}
  );
  await ownTags(run, {label: 'Discussion', id: 'd'}, ['b', 'c'], {replace: true});
  assert.deepEqual(await tagTextsOn(`(:Discussion {id:'d'})`), ['b', 'c']);
});

test('ownTags replace with an empty set clears all tags', async () => {
  await run(
    `CREATE (d:Discussion {id:'d', createdAt: datetime()}), (a:Tag {text:'a'})
     CREATE (d)-[:HAS_TAG]->(a)`,
    {}
  );
  await ownTags(run, {label: 'Discussion', id: 'd'}, [], {replace: true});
  assert.deepEqual(await tagTextsOn(`(:Discussion {id:'d'})`), []);
});

test('createDiscussionWithChannelConnections owns tags: connect creates-if-missing, existing reused', async () => {
  await driver.executeQuery(
    `CREATE (:Channel {uniqueName:'forum', createdAt: datetime()}),
            (:User {username:'author', createdAt: datetime()}),
            (:Tag {text:'old'})`
  );
  const result = await createDiscussionsFromInput(
    createDiscussionCreationRepository(driver),
    driver,
    [{
      discussionCreateInput: {
        title: 'Tagged',
        body: 'body',
        Author: {connect: {where: {node: {username: 'author'}}}},
        // Uniform v7 shape: connect by text. 'old' exists, 'brand-new' does not.
        Tags: {connect: [
          {where: {node: {text: {eq: 'old'}}}},
          {where: {node: {text: {eq: 'brand-new'}}}},
        ]},
      },
      channelConnections: ['forum'],
    }] as never
  );
  const discussionId = (result[0] as {id: string}).id;
  assert.deepEqual(await tagTextsOn(`(:Discussion {id:'${discussionId}'})`), ['brand-new', 'old']);
  assert.equal(await tagNodeCount('old'), 1, "existing 'old' tag not duplicated");
});

const CREATE_CHANNELS = `mutation ($input: [ChannelCreateInput!]!) {
  createChannels(input: $input) { channels { uniqueName } }
}`;
const UPDATE_CHANNELS = `mutation ($where: ChannelWhere!, $update: ChannelUpdateInput!) {
  updateChannels(where: $where, update: $update) { channels { uniqueName } }
}`;

test('createChannels middleware owns tags (connect creates-if-missing)', async () => {
  const result = await graphql({
    schema: channelSchema,
    source: CREATE_CHANNELS,
    contextValue: {driver},
    variableValues: {input: [{uniqueName: 'c1', Tags: {connect: [{where: {node: {text: {eq: 'news'}}}}]}}]},
  });
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  assert.deepEqual(await tagTextsOn(`(:Channel {uniqueName:'c1'})`), ['news']);
});

test('updateChannels middleware replaces the channel tag set', async () => {
  await driver.executeQuery(
    `CREATE (c:Channel {uniqueName:'c2', createdAt: datetime()}), (a:Tag {text:'a'})
     CREATE (c)-[:HAS_TAG]->(a)`
  );
  const result = await graphql({
    schema: channelSchema,
    source: UPDATE_CHANNELS,
    contextValue: {driver},
    variableValues: {where: {uniqueName: {eq: 'c2'}}, update: {Tags: [{connect: [{where: {node: {text: {eq: 'b'}}}}]}]}},
  });
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  assert.deepEqual(await tagTextsOn(`(:Channel {uniqueName:'c2'})`), ['b']);
});
