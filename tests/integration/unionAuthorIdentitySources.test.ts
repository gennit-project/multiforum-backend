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
  await driver.executeQuery(`CREATE(u:User{username:'alice',bio:'Public',createdAt:datetime()})
    CREATE(:Email{address:'alice@union.test'})-[:HAS_EMAIL]->(u)
    CREATE(u)-[:MODERATION_PROFILE]->(m:ModerationProfile{displayName:'Moderator',createdAt:datetime('2026-01-01T00:00:00Z')})
    CREATE(u)-[:AUTHORED_COMMENT]->(:Comment{id:'user',text:'user',isRootComment:true,createdAt:datetime()})
    CREATE(m)-[:AUTHORED_COMMENT]->(:Comment{id:'mod',text:'mod',isRootComment:true,createdAt:datetime()})
    CREATE(:Issue{id:'user',issueNumber:1,isOpen:true,createdAt:datetime()})-[:AUTHORED_ISSUE]->(u)
    CREATE(:Issue{id:'mod',issueNumber:2,isOpen:true,createdAt:datetime()})-[:AUTHORED_ISSUE]->(m)`);
}, { timeout: 240000 });
after(async () => stopNeo4j());
const context = () => ({ driver, req: { headers: {} }, user: { username: 'alice', email: null, email_verified: true, data: null } });
for (const {root, field} of [{root:'comments',field:'CommentAuthor'},{root:'issues',field:'Author'}]) {
  test(`${root} user union author supplies protected identity without username selection`, async () => {
    const response = await graphql({ schema, source: `{${root}(where:{id:{eq:"user"}}){${field}{... on User{Email{address}}}}}`, contextValue: context() });
    assert.equal(response.errors, undefined, JSON.stringify(response.errors));
    assert.deepEqual(JSON.parse(JSON.stringify(response.data)), { [root]: [{ [field]: { Email: { address: 'alice@union.test' } } }] });
  });
  test(`${root} moderator union author keeps its type without displayName selection`, async () => {
    const response = await graphql({ schema, source: `{${root}(where:{id:{eq:"mod"}}){${field}{__typename ... on ModerationProfile{createdAt}}}}`, contextValue: context() });
    assert.equal(response.errors, undefined, JSON.stringify(response.errors));
    assert.deepEqual(JSON.parse(JSON.stringify(response.data)), { [root]: [{ [field]: { __typename: 'ModerationProfile', createdAt: '2026-01-01T00:00:00.000Z' } }] });
  });
}

const authorSources = [
  { root: 'comments', field: 'CommentAuthor', union: 'CommentAuthor' },
  { root: 'issues', field: 'Author', union: 'IssueAuthor' },
];
for (const { root, field, union } of authorSources) for (const connection of [false, true]) for (const viewer of ['alice', 'bob', null]) {
  test(`${root} ${connection ? 'connection' : 'list'} author aliases cannot replace type or identity for ${viewer ?? 'anonymous'}`, async () => {
    const source = connection
      ? `query($show:Boolean!=true){page:${root}Connection(where:{id:{in:["mod","user"]}},sort:[{id:ASC}]){links:edges{item:node{id person:${field}{...Actor}}}}}`
      : `query($show:Boolean!=true){page:${root}(where:{id:{in:["mod","user"]}},sort:[{id:ASC}]){id person:${field}{...Actor}}}`;
    const response = await graphql({ schema, source: source + ` fragment Actor on ${union}{
      kind:__typename ...PrivateUser ...PrivateMod
    } fragment PrivateUser on User{
      displayName:bio _accountIdentity:bio _moderatorIdentity:bio contact:Email @include(if:$show){address}
    } fragment PrivateMod on ModerationProfile{
      username:displayName _accountIdentity:displayName _moderatorIdentity:displayName forbidden:User{username}
    }`, contextValue: { driver, req: { headers: {} }, user: viewer ? { username: viewer, email: null, email_verified: true, data: null } : null } });
    const items = [
      { id: 'mod', person: { kind: 'ModerationProfile', username: 'Moderator', _accountIdentity: 'Moderator', _moderatorIdentity: 'Moderator', forbidden: null } },
      { id: 'user', person: { kind: 'User', displayName: 'Public', _accountIdentity: 'Public', _moderatorIdentity: 'Public', contact: viewer === 'alice' ? { address: 'alice@union.test' } : null } },
    ];
    assert.deepEqual(JSON.parse(JSON.stringify(response.data)), connection ? { page: { links: items.map(item => ({ item })) } } : { page: items });
    const prefix = (index: number) => connection ? ['page', 'links', index, 'item', 'person'] : ['page', index, 'person'];
    const paths = [[...prefix(0), 'forbidden'], ...(viewer === 'alice' ? [] : [[...prefix(1), 'contact']])];
    assert.deepEqual(response.errors?.map(error => JSON.stringify(error.path)).sort(), paths.map(path => JSON.stringify(path)).sort(), JSON.stringify(response));
  });
}
for (const { root, field } of authorSources) test(`${root} author type preserves skips, missing results and nullable authors`, async () => {
  await driver.executeQuery(`MERGE(n:${root === 'comments' ? 'Comment' : 'Issue'}{id:'orphan'}) SET n.createdAt=datetime(),n.issueNumber=3,n.isOpen=true,n.isRootComment=true`);
  const response = await graphql({ schema, source: `query($hide:Boolean!=true){
    orphan:${root}(where:{id:{eq:"orphan"}}){${field}{__typename}}
    skipped:${root}(where:{id:{eq:"user"}}){id ${field} @skip(if:$hide){... on User{Email{address}}}}
    public:${root}(where:{id:{eq:"user"}}){${field}{__typename ... on User{Email @skip(if:$hide){address}}}}
    missing:${root}(where:{id:{eq:"missing"}}){${field}{__typename}}
  }`, contextValue: { driver, req: { headers: {} } } });
  assert.equal(response.errors, undefined, JSON.stringify(response.errors));
  assert.deepEqual(JSON.parse(JSON.stringify(response.data)), { orphan: [{ [field]: null }], skipped: [{ id: 'user' }], public: [{ [field]: { __typename: 'User' } }], missing: [] });
});
test('nullable and malformed moderator display names do not become union discriminators', async () => {
  for (const displayName of [null, ['malformed']]) {
    await driver.executeQuery('MATCH(m:ModerationProfile) SET m.displayName=$displayName', { displayName });
    try {
      const unselected = await graphql({ schema, source: '{comments(where:{id:{eq:"mod"}}){CommentAuthor{__typename ... on ModerationProfile{createdAt}}}}', contextValue: context() });
      assert.equal(unselected.errors, undefined, JSON.stringify(unselected.errors));
      assert.deepEqual(JSON.parse(JSON.stringify(unselected.data)), { comments: [{ CommentAuthor: { __typename: 'ModerationProfile', createdAt: '2026-01-01T00:00:00.000Z' } }] });
      const selected = await graphql({ schema, source: '{comments(where:{id:{eq:"mod"}}){CommentAuthor{__typename ... on ModerationProfile{displayName}}}}', contextValue: context() });
      if (displayName === null) assert.equal(selected.errors, undefined, JSON.stringify(selected.errors));
      else assert.deepEqual(selected.errors?.map(error => error.path), [['comments', 0, 'CommentAuthor', 'displayName']], JSON.stringify(selected));
      assert.deepEqual(JSON.parse(JSON.stringify(selected.data)), { comments: [{ CommentAuthor: { __typename: 'ModerationProfile', displayName: null } }] });
    } finally { await driver.executeQuery("MATCH(m:ModerationProfile) SET m.displayName='Moderator'"); }
  }
});
for (const { root, field } of authorSources) test(`${root} author dependencies preserve sensitive-content filtering`, async () => {
  await driver.executeQuery(`MATCH(n:${root === 'comments' ? 'Comment' : 'Issue'}{id:'user'}) SET n.ageGateRestricted=true`);
  try {
    const response = await graphql({ schema, source: `{${root}(where:{id:{eq:"user"}}){${field}{... on User{Email{address}}}} ${root}Connection(where:{id:{eq:"user"}}){totalCount edges{node{${field}{__typename}}}}}`, contextValue: context() });
    assert.equal(response.errors, undefined, JSON.stringify(response.errors));
    assert.deepEqual(JSON.parse(JSON.stringify(response.data)), { [root]: [], [root + 'Connection']: { totalCount: 0, edges: [] } });
  } finally { await driver.executeQuery(`MATCH(n:${root === 'comments' ? 'Comment' : 'Issue'}{id:'user'}) SET n.ageGateRestricted=false`); }
});
