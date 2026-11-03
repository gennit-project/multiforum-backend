import assert from 'node:assert/strict';
import { before, beforeEach, after, test } from 'node:test';
import { Neo4jGraphQL } from '@neo4j/graphql';
import { graphql, defaultFieldResolver, type GraphQLObjectType, type GraphQLSchema } from 'graphql';
import { applyMiddleware } from 'graphql-middleware';
import type { Driver, ManagedTransaction } from 'neo4j-driver';
import typeDefs from '../../typeDefs.js';
import permissions from '../../permissions.js';
import { installAgeGateReconcile } from '../../services/ageGate/reconcile.js';
import { getAgeGateStatements } from '../../services/ageGate/definitions.js';
import getResolvers from '../helpers/getTestResolvers.js';
import createResolver, { triggerCreatedDiscussionPipelines } from '../../customResolvers/mutations/createDiscussionWithChannelConnections.js';
import shareResolver from '../../customResolvers/mutations/shareCollectionAsDiscussion.js';
import { registerGeneratedSchema } from '../../services/persistence/generatedSchemaOperations.js';
import { startNeo4j, stopNeo4j, resetDatabase } from './neo4jHarness.js';

let driver: Driver, instrumented: Driver, schema: GraphQLSchema;
let failAfter = '', retry = false, attempts = 0, pluginFailure = false;
let failOnMatch = 1, matches = 0;
let failProjection = false;
let beforeWrite: (() => Promise<void>) | undefined;
let tasks: Promise<unknown[]>[] = [];
let observed: Array<{ id: string; channel: string; links: number }> = [];
// Faults happen AFTER real writes. Both auto-commit and transaction paths are
// instrumented so reverting the production fix exposes the old partial graph.
const intercept = (target: any) => new Proxy(target, { get(object, key) {
  if (key === 'run' || key === 'executeQuery') return async (query: string, params?: any) => {
    const result = await object[key](query, params);
    if (failAfter && query.includes(failAfter) && ++matches === failOnMatch) throw new Error('Injected owned-write failure');
    return result;
  };
  const value = object[key];
  return typeof value === 'function' ? value.bind(object) : value;
}});
before(async () => {
  driver = installAgeGateReconcile(await startNeo4j(), getAgeGateStatements(typeDefs));
  instrumented = new Proxy(intercept(driver), { get(object, key) {
    if (key === 'session') return (...args: any[]) => {
      const session = (driver.session as any)(...args);
      return new Proxy(intercept(session), { get(object, key) {
        if (key === 'executeWrite') return async (work: any) => {
          if (beforeWrite) { const hook = beforeWrite; beforeWrite = undefined; await hook(); }
          if (retry) {
            retry = false;
            const tx = session.beginTransaction();
            try { attempts++; await work(intercept(tx)); } finally { await tx.rollback(); }
            assert.equal(observed.length, 0, 'no plugin call before retry/commit');
          }
          return session.executeWrite(async (tx: ManagedTransaction) => { attempts++; return work(intercept(tx)); });
        };
        return object[key];
      }});
    };
    return (object as any)[key];
  }});
  const triggerPipelines: typeof triggerCreatedDiscussionPipelines = args => triggerCreatedDiscussionPipelines({
    ...args,
    triggerDownload: async () => { throw new Error('Unexpected download'); },
    triggerChannel: ({ discussionId, channelUniqueName }) => {
      const task = (async () => {
      // A separate session must see the entire item, proving the commit preceded
      // the effect. This callback never invokes a provider or remote service.
      const result = await driver.executeQuery(`MATCH (:User {username:'alice'})-[:POSTED_DISCUSSION]->(d:Discussion {id:$id})
        MATCH (dc:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(d)
        RETURN count(dc) AS links`, { id: discussionId });
      observed.push({ id: discussionId!, channel: channelUniqueName, links: result.records[0].get('links').toNumber() });
      if (pluginFailure) throw new Error('Fixture plugin unavailable');
      return [];
      })();
      tasks.push(task);
      return task;
    },
  });
  const resolvers = getResolvers(driver).resolvers;
  resolvers.Mutation.createDiscussionWithChannelConnections = createResolver({ driver: instrumented, triggerPipelines });
  resolvers.Mutation.shareCollectionAsDiscussion = shareResolver({ driver: instrumented, triggerPipelines });
  const raw = await new Neo4jGraphQL({ driver, typeDefs, resolvers, features: { filters: { String: { MATCHES: true } } } }).getSchema();
  const titleField = (raw.getType('Discussion') as GraphQLObjectType).getFields().title;
  titleField.resolve = (source, args, context, info) => {
    if (failProjection) throw new Error('Injected generated response failure');
    return defaultFieldResolver(source, args, context, info);
  };
  registerGeneratedSchema(driver, raw);
  registerGeneratedSchema(instrumented, raw);
  schema = applyMiddleware(raw, permissions);
}, { timeout: 240_000 });
after(async () => stopNeo4j());
beforeEach(async () => {
  failAfter = ''; retry = false; attempts = 0; pluginFailure = false; observed = []; tasks = []; failOnMatch = 1; matches = 0; beforeWrite = undefined; failProjection = false;
  await resetDatabase(driver);
  await driver.executeQuery(`CREATE (u:User {username:'alice',createdAt:datetime(),notifyOnReplyToDiscussionByDefault:true}),
    (b:User {username:'bob',createdAt:datetime()}), (c:Channel {uniqueName:'forum',imageUploadsEnabled:true}),
    (c2:Channel {uniqueName:'second',imageUploadsEnabled:true}),
    (collection:Collection {id:'collection',name:'Collection',visibility:'PUBLIC',createdAt:datetime(),updatedAt:datetime()}),
    (image:Image {id:'reused',url:'reuse.jpg',createdAt:datetime()})
    CREATE (u)-[:ADMIN_OF_CHANNEL]->(c) CREATE (u)-[:ADMIN_OF_CHANNEL]->(c2)
    CREATE (collection)-[:CREATED_BY]->(u) CREATE (b)-[:UPLOADED_IMAGE]->(image)`);
});
const CREATE = `mutation($input:[DiscussionCreateInputWithChannels!]!){createDiscussionWithChannelConnections(input:$input){id title Author{username} Tags{text} DiscussionChannels{channelUniqueName}}}`;
const SHARE = `mutation{shareCollectionAsDiscussion(collectionId:"collection",serverId:"forum",title:"Shared"){id title SharedCollection{id}}}`;
const item = (title = 'Created') => ({ discussionCreateInput: { title, Tags: { create: [{ node: { text: 'new-tag' } }] },
  Album: { create: { node: { imageOrder: [], Images: { create: [{ node: { url: 'new.jpg' } }], connect: [{ where: { node: { id: { eq: 'reused' } } } }] } } } } },
  channelConnections: ['forum', 'second'] });
const execute = async (source: string, variables: Record<string, unknown> = {}, username = 'alice') => { const result = await graphql({ schema, source, variableValues: variables,
  contextValue: { driver: instrumented, req: { headers: {} }, user: { username, email: null, email_verified: true, data: null }, mayAccessSensitiveContent: false } });
  await Promise.allSettled(tasks);
  return result;
};
const ok = (result: Awaited<ReturnType<typeof execute>>) => { assert.equal(result.errors, undefined, JSON.stringify(result.errors)); return result.data as any; };
async function assertEmptyItem() {
  const result = await driver.executeQuery('MATCH(n) WHERE n:Discussion OR n:DiscussionChannel OR n:Album OR n:Tag OR (n:Image AND n.id <> "reused") RETURN n');
  assert.equal(result.records.length, 0, 'no partial item or nested nodes');
  assert.equal((await driver.executeQuery('MATCH(:User {username:"bob"})-[:UPLOADED_IMAGE]->(:Image {id:"reused"}) RETURN 1')).records.length, 1);
  assert.equal(observed.length, 0);
}
test('ordinary creation commits nested content, ownership, tags and all channels before plugins', async () => {
  const created = ok(await execute(CREATE, { input: [item()] })).createDiscussionWithChannelConnections[0];
  assert.equal(created.Author.username, 'alice');
  assert.deepEqual(created.Tags.map((tag: {text:string}) => tag.text), ['new-tag']);
  assert.deepEqual(observed.map(x => x.links), [2, 2]);
  const votes = await driver.executeQuery('MATCH(:User {username:"alice"})-[:UPVOTED_DISCUSSION]->(dc:DiscussionChannel)<-[:SUBSCRIBED_TO_NOTIFICATIONS]-(:User {username:"alice"}) RETURN dc');
  assert.equal(votes.records.length, 2);
  const ownership = await driver.executeQuery(`MATCH(:Discussion {id:$id})-[:HAS_ALBUM]->(a:Album)<-[:HAS_ALBUM]-(:User {username:'alice'})
    MATCH(a)-[:HAS_IMAGE]->(i:Image)<-[:UPLOADED_IMAGE]-(u:User) RETURN i.url AS url,u.username AS owner ORDER BY url`, { id: created.id });
  assert.deepEqual(ownership.records.map(r => r.toObject()), [{url:'new.jpg',owner:'alice'},{url:'reuse.jpg',owner:'bob'}]);
});
for (const [stage, marker] of Object.entries({ author: 'MERGE (author)-[:POSTED_DISCUSSION]', tags: 'MERGE (tag:Tag', albumOwnership: 'img.id IN', forum: 'as discussionChannel' })) {
  test(`failure after ${stage} rolls back the entire item`, async () => {
    failAfter = marker;
    const result = await execute(CREATE, { input: [item()] });
    assert.match(JSON.stringify(result.errors), /Injected owned-write failure/);
    await assertEmptyItem();
  });
}
test('transaction callback retry does not duplicate content or plugin calls', async () => {
  retry = true;
  ok(await execute(CREATE, { input: [item()] }));
  assert.equal(attempts, 2);
  assert.deepEqual(observed.map(x => x.links), [2, 2]);
  assert.equal((await driver.executeQuery('MATCH(d:Discussion) RETURN d')).records.length, 1);
});
test('plugin failure preserves the committed item and attempts the remaining channel', async () => {
  pluginFailure = true;
  ok(await execute(CREATE, { input: [item()] }));
  assert.deepEqual(observed.map(x => x.links), [2, 2]);
});
test('sharing commits the collection reference and forum link before triggering', async () => {
  const shared = ok(await execute(SHARE)).shareCollectionAsDiscussion;
  assert.equal((await driver.executeQuery('MATCH(:Discussion {id:$id})-[:SHARES_COLLECTION]->(:Collection {id:"collection"}) RETURN 1', {id:shared.id})).records.length, 1);
  assert.deepEqual(observed.map(x => x.links), [1]);
});
test('sharing rolls back on forum-link failure and preserves the source collection', async () => {
  failAfter = 'as discussionChannel';
  assert.match(JSON.stringify((await execute(SHARE)).errors), /Injected owned-write failure/);
  await assertEmptyItem();
  assert.equal((await driver.executeQuery('MATCH(:Collection {id:"collection"})-[:CREATED_BY]->(:User {username:"alice"}) RETURN 1')).records.length, 1);
});
test('anonymous creation, non-owner sharing and private collection sharing retain permission checks', async () => {
  assert.ok((await execute(CREATE, { input: [item()] }, '')).errors);
  assert.ok((await execute(SHARE, {}, 'bob')).errors);
  await driver.executeQuery('MATCH(c:Collection) SET c.visibility="PRIVATE"');
  assert.ok((await execute(SHARE)).errors);
  await assertEmptyItem();
});

test('a forum deleted after preflight cannot leave an unlinked item or trigger plugins', async () => {
  beforeWrite = async () => { await driver.executeQuery('MATCH(c:Channel {uniqueName:"second"}) DETACH DELETE c'); };
  assert.match(JSON.stringify((await execute(CREATE, {input:[item()]})).errors), /Could not connect/);
  await assertEmptyItem();
});
test('a collection deleted after the ownership check cannot produce an empty share', async () => {
  beforeWrite = async () => { await driver.executeQuery('MATCH(c:Collection {id:"collection"}) DETACH DELETE c'); };
  assert.match(JSON.stringify((await execute(SHARE)).errors), /Shared collection is no longer available/);
  await assertEmptyItem();
});
test('a failed later batch item rolls back only that item and does not attempt subsequent items', async () => {
  failAfter = 'as discussionChannel'; failOnMatch = 3;
  assert.match(JSON.stringify((await execute(CREATE, {input:[item('First'),item('Failed'),item('Unattempted')]})).errors), /Injected owned-write failure/);
  const rows = await driver.executeQuery('MATCH(d:Discussion) RETURN d.title AS title');
  assert.deepEqual(rows.records.map(r=>r.get('title')), ['First']);
  assert.deepEqual(observed.map(x=>x.links), [2,2]);
  assert.equal((await driver.executeQuery('MATCH(a:Album) RETURN a')).records.length, 1);
  assert.equal((await driver.executeQuery('MATCH(i:Image) RETURN i')).records.length, 2);
});
test('duplicate requested forums retain validation without writes', async () => {
  const input = item(); input.channelConnections = ['forum','forum','second'];
  assert.match(JSON.stringify((await execute(CREATE, {input:[input]})).errors), /selected more than once/);
  await assertEmptyItem();
});

test('failure after the second forum link rolls back earlier forum links too', async () => {
  failAfter = 'as discussionChannel'; failOnMatch = 2;
  assert.match(JSON.stringify((await execute(CREATE, {input:[item()]})).errors), /Injected owned-write failure/);
  await assertEmptyItem();
});
test('generated create response errors roll back the generated write and nested nodes', async () => {
  failProjection = true;
  assert.match(JSON.stringify((await execute(CREATE, {input:[item()]})).errors), /Injected generated response failure/);
  await assertEmptyItem();
});
