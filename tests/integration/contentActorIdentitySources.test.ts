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
  await driver.executeQuery(`UNWIND ['alice','bob'] AS username
    CREATE(u:User{username:username,bio:'alice',createdAt:datetime()})
    CREATE(:Email{address:username+'@actor.test'})-[:HAS_EMAIL]->(u)
    CREATE(u)-[:POSTED_DISCUSSION]->(d:Discussion{id:username,title:username,createdAt:datetime(),hasSensitiveContent:false})
    CREATE(d)-[:BODY_LAST_EDITED_BY]->(u)
    CREATE(u)-[:POSTED_BY]->(e:Event{id:username,title:username,startTime:datetime(),endTime:datetime(),createdAt:datetime(),canceled:false})
    CREATE(e)-[:DESCRIPTION_LAST_EDITED_BY]->(u)
    CREATE(u)-[:POSTED_BY]->(:EventSeries{id:username,title:username,createdAt:datetime()})`);
  await driver.executeQuery("CREATE(:Discussion{id:'orphan',title:'orphan',createdAt:datetime(),hasSensitiveContent:false}) CREATE(:Event{id:'orphan',title:'orphan',startTime:datetime(),endTime:datetime(),createdAt:datetime(),canceled:false}) CREATE(:EventSeries{id:'orphan',title:'orphan',createdAt:datetime()})");
  await driver.executeQuery("MATCH(u:User{username:'alice'}) CREATE(u)-[:POSTED_DISCUSSION]->(:Discussion{id:'sensitive',title:'sensitive',hasSensitiveContent:true,createdAt:datetime()})");
}, { timeout: 240000 });
after(async () => stopNeo4j());
function context(viewer: string | null) {
  return { driver, req: { headers: {} }, jwt: viewer ? { sub: viewer, mayAccessSensitiveContent: false } : undefined,
    user: viewer ? { username: viewer, email: null, email_verified: true, data: null } : null, mayAccessSensitiveContent: false };
}
const sources = [
  { root: 'discussions', type: 'Discussion', field: 'Author' },
  { root: 'discussions', type: 'Discussion', field: 'BodyLastEditedBy' },
  { root: 'events', type: 'Event', field: 'Poster' },
  { root: 'events', type: 'Event', field: 'DescriptionLastEditedBy' },
  { root: 'eventSeries', type: 'EventSeries', field: 'Poster' },
];
for (const { root, field } of sources) test(`${root}.${field} supplies owner identity without selected username`, async () => {
  const response = await graphql({ schema, source: `{${root}(where:{id:{eq:"alice"}}){${field}{Email{address}}}}`, contextValue: context('alice') });
  assert.equal(response.errors, undefined, JSON.stringify(response.errors));
  assert.deepEqual(JSON.parse(JSON.stringify(response.data)), { [root]: [{ [field]: { Email: { address: 'alice@actor.test' } } }] });
});

for (const { root, type, field } of sources) for (const connection of [false, true]) for (const viewer of ['alice', null]) {
  test(`${root}.${field} preserves ${connection ? 'connection' : 'list'} aliases and private children for ${viewer ?? 'anonymous'}`, async () => {
    const selection = `id person:${field}{key:username username:bio _accountIdentity:bio ...Private}`;
    const source = connection
      ? `query($show:Boolean!=true){page:${root}Connection(where:{id:{in:["alice","bob"]}},sort:[{id:ASC}]){links:edges{entry:node{...Attribution}}}}`
      : `query($show:Boolean!=true){page:${root}(where:{id:{in:["alice","bob"]}},sort:[{id:ASC}]){...Attribution}}`;
    const response = await graphql({ schema, source: source + ` fragment Attribution on ${type}{${selection}} fragment Private on User{contact:Email @include(if:$show){address}}`, contextValue: context(viewer) });
    const data = JSON.parse(JSON.stringify(response.data));
    const expected = ['alice', 'bob'].map(id => ({ id, person: { key: id, username: 'alice', _accountIdentity: 'alice', contact: viewer === id ? { address: id + '@actor.test' } : null } }));
    assert.deepEqual(data, connection ? { page: { links: expected.map(entry => ({ entry })) } } : { page: expected });
    const expectedPaths = ['alice', 'bob'].flatMap((id, index) => id === viewer ? [] : [connection ? ['page', 'links', index, 'entry', 'person', 'contact'] : ['page', index, 'person', 'contact']]);
    assert.deepEqual(response.errors?.map(error => error.path), expectedPaths, JSON.stringify(response));
  });
}

for (const { root, field } of sources) test(`${root}.${field} preserves null owners, skipped fields and empty results`, async () => {
  const response = await graphql({ schema, source: `query($hide:Boolean!=true){
    orphan:${root}(where:{id:{eq:"orphan"}}){${field}{Email{address}}}
    skipped:${root}(where:{id:{eq:"bob"}}){${field}{key:username Email @skip(if:$hide){address}}}
    missing:${root}(where:{id:{eq:"missing"}}){${field}{Email{address}}}
  }`, contextValue: context('alice') });
  assert.equal(response.errors, undefined, JSON.stringify(response.errors));
  assert.deepEqual(JSON.parse(JSON.stringify(response.data)), { orphan: [{ [field]: null }], skipped: [{ [field]: { key: 'bob' } }], missing: [] });
});

test('discussion author identity preserves generated sensitive-content filtering', async () => {
  for (const viewer of ['alice', null]) {
    const response = await graphql({ schema, source: `{discussions(where:{id:{eq:"sensitive"}}){Author{Email{address}}} discussionsConnection(where:{id:{eq:"sensitive"}}){totalCount edges{node{Author{Email{address}}}}}}`, contextValue: context(viewer) });
    assert.equal(response.errors, undefined, JSON.stringify(response.errors));
    assert.deepEqual(JSON.parse(JSON.stringify(response.data)), { discussions: [], discussionsConnection: { totalCount: 0, edges: [] } });
  }
});

test('attribution identity keeps requested scalar failures local to the selected field', async () => {
  await driver.executeQuery("MATCH(u:User{username:'alice'}) SET u.bio=[1,2]");
  try {
    const response = await graphql({ schema, source: '{discussions(where:{id:{eq:"alice"}}){Author{broken:bio Email{address}}}}', contextValue: context('alice') });
    assert.deepEqual(response.errors?.map(error => error.path), [['discussions', 0, 'Author', 'broken']], JSON.stringify(response));
    assert.deepEqual(JSON.parse(JSON.stringify(response.data)), { discussions: [{ Author: { broken: null, Email: { address: 'alice@actor.test' } } }] });
  } finally {
    await driver.executeQuery("MATCH(u:User{username:'alice'}) SET u.bio='alice'");
  }
});
