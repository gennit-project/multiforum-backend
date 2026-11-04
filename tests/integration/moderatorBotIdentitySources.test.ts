import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import type { Driver } from 'neo4j-driver';
import { Neo4jGraphQL } from '@neo4j/graphql';
import { graphql, type GraphQLSchema } from 'graphql';
import { applyMiddleware } from 'graphql-middleware';
import typeDefs from '../../typeDefs.js';
import permissions from '../../permissions.js';
import userChildIdentityMiddleware from '../../middleware/userChildIdentityMiddleware.js';
import getResolvers from '../helpers/getTestResolvers.js';
import { registerGeneratedSchema } from '../../services/persistence/generatedSchemaOperations.js';
import { startNeo4j, stopNeo4j, resetDatabase } from './neo4jHarness.js';
let driver: Driver;
let schema: GraphQLSchema;
before(async () => {
  driver = await startNeo4j();
  await resetDatabase(driver);
  const raw = await new Neo4jGraphQL({ driver, typeDefs, resolvers: getResolvers(driver).resolvers }).getSchema();
  registerGeneratedSchema(driver, raw);
  schema = applyMiddleware(raw, userChildIdentityMiddleware, permissions);
  await driver.executeQuery(`UNWIND ['bot','human'] AS username
    CREATE(u:User{username:username,bio:'bot',isBot:username='bot',createdAt:datetime()})
    CREATE(:Email{address:username+'@identity.test'})-[:HAS_EMAIL]->(u)
    CREATE(u)-[:MODERATION_PROFILE]->(:ModerationProfile{displayName:username,createdAt:datetime()})
    CREATE(:ModerationProfile{displayName:'orphan-'+username,createdAt:datetime()})`);
}, { timeout: 240000 });
after(async () => stopNeo4j());
function context(viewer: string | null) {
  return { driver, req: { headers: {} }, user: viewer ? { username: viewer, email: null, email_verified: true, data: null } : null };
}
test('bot profile source supplies owner identity without username selection', async () => {
  const response = await graphql({ schema, source: '{moderationProfiles(where:{displayName:{eq:"bot"}}){BotUser{Email{address}}}}', contextValue: context('bot') });
  assert.equal(response.errors, undefined, JSON.stringify(response.errors));
  assert.deepEqual(JSON.parse(JSON.stringify(response.data)), { moderationProfiles: [{ BotUser: { Email: { address: 'bot@identity.test' } } }] });
});
for (const connection of [false, true]) for (const viewer of ['bot', 'human', null]) {
  test(`bot profile ${connection ? 'connection' : 'list'} preserves pseudonymity and child permissions for ${viewer ?? 'anonymous'}`, async () => {
    const source = connection
      ? 'query($show:Boolean!=true){page:moderationProfilesConnection(sort:[{displayName:ASC}]){links:edges{entry:node{...Profile}}}}'
      : 'query($show:Boolean!=true){page:moderationProfiles(sort:[{displayName:ASC}]){...Profile}}';
    const response = await graphql({ schema, source: source + ` fragment Profile on ModerationProfile{
      name:displayName account:BotUser{username:bio _accountIdentity:bio ...Private}
      forbidden:User{username}
    } fragment Private on User{contact:Email @include(if:$show){address}}`, contextValue: context(viewer) });
    const items = ['bot', 'human', 'orphan-bot', 'orphan-human'].map(name => ({ name,
      account: name === 'bot' ? { username: 'bot', _accountIdentity: 'bot', contact: viewer === 'bot' ? { address: 'bot@identity.test' } : null } : null,
      forbidden: null,
    }));
    assert.deepEqual(JSON.parse(JSON.stringify(response.data)), connection ? { page: { links: items.map(entry => ({ entry })) } } : { page: items });
    const prefix = (index: number) => connection ? ['page', 'links', index, 'entry'] : ['page', index];
    const paths = items.map((_item, index) => [...prefix(index), 'forbidden']);
    if (viewer !== 'bot') paths.push([...prefix(0), 'account', 'contact']);
    assert.deepEqual(response.errors?.map(error => JSON.stringify(error.path)).sort(), paths.map(path => JSON.stringify(path)).sort(), JSON.stringify(response));
  });
}
test('bot identity dependency preserves skipped private and forbidden fields and missing profiles', async () => {
  const response = await graphql({ schema, source: `query($hide:Boolean!=true){
    moderationProfiles(where:{displayName:{eq:"bot"}}){BotUser{key:username Email @skip(if:$hide){address}} User @skip(if:$hide){username}}
    missing:moderationProfiles(where:{displayName:{eq:"missing"}}){BotUser{Email{address}}}
  }`, contextValue: context(null) });
  assert.equal(response.errors, undefined, JSON.stringify(response.errors));
  assert.deepEqual(JSON.parse(JSON.stringify(response.data)), { moderationProfiles: [{ BotUser: { key: 'bot' } }], missing: [] });
});
test('bot identity dependency does not eagerly validate unselected fields', async () => {
  await driver.executeQuery("MATCH(u:User{username:'bot'}) SET u.bio=[1,2]");
  try {
    const source = '{moderationProfiles(where:{displayName:{eq:"bot"}}){BotUser{Email{address}}}}';
    const unselected = await graphql({ schema, source, contextValue: context('bot') });
    assert.equal(unselected.errors, undefined, JSON.stringify(unselected.errors));
    const selected = await graphql({ schema, source: source.replace('Email{address}', 'bad:bio Email{address}'), contextValue: context('bot') });
    assert.deepEqual(selected.errors?.map(error => error.path), [['moderationProfiles', 0, 'BotUser', 'bad']], JSON.stringify(selected));
    assert.deepEqual(JSON.parse(JSON.stringify(selected.data)), { moderationProfiles: [{ BotUser: { bad: null, Email: { address: 'bot@identity.test' } } }] });
  } finally { await driver.executeQuery("MATCH(u:User{username:'bot'}) SET u.bio='bot'"); }
});
