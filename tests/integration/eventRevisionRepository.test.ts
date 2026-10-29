import getUpdateEvent from '../../customResolvers/mutations/updateEventWithChannelConnections.js';
import assert from 'node:assert/strict';
import {before, after, beforeEach, test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import {graphql, type GraphQLSchema} from 'graphql';
import {applyMiddleware} from 'graphql-middleware';
import {Neo4jError, type Driver} from 'neo4j-driver';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import permissions from '../../permissions.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createEventRevisionRepository} from '../../services/persistence/eventRevisionRepository.js';
import middleware from '../../middleware/eventVersionHistoryMiddleware.js';
import {installAgeGateReconcile} from '../../services/ageGate/reconcile.js';
import {getAgeGateStatements} from '../../services/ageGate/definitions.js';
import {resetDatabase,startNeo4j,stopNeo4j} from './neo4jHarness.js';

let driver: Driver;
let schema: GraphQLSchema;
before(async () => {
  driver = installAgeGateReconcile(await startNeo4j(), getAgeGateStatements(typeDefs));
  const neo = new Neo4jGraphQL({driver, typeDefs, resolvers:getCustomResolvers(driver).resolvers, features:{filters:{String:{MATCHES:true}}}});
  const base = await neo.getSchema();
  registerGeneratedSchema(driver, base);
  schema = applyMiddleware(base, permissions as any, middleware as any);
}, {timeout:240000});
after(stopNeo4j);
beforeEach(async () => {
  await resetDatabase(driver);
  await driver.executeQuery(`CREATE (p:User {username:'poster', createdAt:datetime()}),
    (prior:User {username:'prior', createdAt:datetime()}),
    (e:Event {id:'e', title:'old title', description:'old description', canceled:false, startTime:datetime('2026-01-01T00:00:00Z'), endTime:datetime('2026-01-02T00:00:00Z'), createdAt:datetime()}),
    (i:Issue {id:'issue', issueNumber:1, title:'Review', isOpen:true, relatedEventId:'e'})
    CREATE (p)-[:POSTED_BY]->(e), (e)-[:DESCRIPTION_LAST_EDITED_BY]->(prior)`);
});
const state = async () => {
  const result = await driver.executeQuery(`MATCH (e:Event {id:'e'})
    OPTIONAL MATCH (e)-[:DESCRIPTION_LAST_EDITED_BY]->(u:User)
    RETURN e.title AS title, e.description AS description, u.username AS editor,
      [(e)-[:HAS_TITLE_VERSION]->(v:TextVersion) | v.body] AS titles,
      [(e)-[:HAS_DESCRIPTION_VERSION]->(v:TextVersion) | v.body] AS descriptions`);
  return result.records[0].toObject();
};
const edit = async (options: {title?:string; description?:string; repository?:any; unauthorized?:boolean; where?:any; projection?:string} = {}) => graphql({
  schema,
  source:`mutation Edit($where:EventWhere!, $update:EventUpdateInput!) {updateEvents(where:$where, update:$update) {events {id ${options.projection ?? 'title description'}}}}`,
  variableValues:{where:options.where ?? {id:{eq:'e'}}, update:{title:{set:options.title ?? 'new title'}, description:{set:options.description ?? 'new description'}}},
  contextValue:{driver, req:{headers:{}}, user: options.unauthorized ? {} : {username:'poster',data:{}},
    eventRevisionRepository: options.repository,
    // Exercise real activity persistence, but no external mail recipients.
  },
});

test('public GraphQL 7 middleware commits edit, preceding text, attribution and revision activities', async () => {
  const result = await edit({projection:'title description PastTitleVersions {body} PastDescriptionVersions {body} DescriptionLastEditedBy {username}'}); assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  assert.equal((result.data as any).updateEvents.events[0].PastTitleVersions[0].body,'old title');
  assert.deepEqual(await state(), {title:'new title',description:'new description',editor:'poster',titles:['old title'],descriptions:['old description']});
  const rows = (await driver.executeQuery(`MATCH (v:TextVersion)<-[:AUTHORED_VERSION]-(u:User)
    OPTIONAL MATCH (:Issue {id:'issue'})-[:ACTIVITY_ON_ISSUE]->(a:ModerationAction)-[:HAS_REVISION]->(v)
    RETURN v.body AS body, u.username AS author, a.actionDescription AS action ORDER BY body`)).records.map(r=>r.toObject());
  assert.deepEqual(rows,[{body:'old description',author:'prior',action:'edited the event description'},{body:'old title',author:'poster',action:'edited the event title'}]);
});
for (const boundary of ['before-history','after-history']) test(`failure ${boundary} rolls back edit, history and editor; retry succeeds`, async t => {
  const repo = createEventRevisionRepository(driver); const original = repo.recordChanges;
  t.mock.method(repo,'recordChanges',async (...args: Parameters<typeof original>) => {
    if(boundary==='after-history')await original(...args);
    throw Error('injected write failure');
  });
  const result=await edit({repository:repo}); assert.match(result.errors?.[0].message ?? '',/injected write failure/);
  assert.deepEqual(await state(),{title:'old title',description:'old description',editor:'prior',titles:[],descriptions:[]});
  assert.equal((await driver.executeQuery('MATCH(v:TextVersion) RETURN count(v) AS n')).records[0].get('n').toNumber(),0);
  assert.equal((await edit()).errors,undefined);
});
test('concurrent edits capture the actual preceding content', async () => {
  const results = await Promise.all(['one','two'].map(title => edit({title,description:title})));
  for(const [index,result] of results.entries()) {
    assert.equal(result.errors,undefined,JSON.stringify(result.errors));
    assert.equal((result.data as any).updateEvents.events[0].title,['one','two'][index]);
  }
  const current=await state();
  assert.deepEqual([...current.titles].sort(),['old title',current.title==='one'?'two':'one'].sort());
  assert.deepEqual([...current.descriptions].sort(),['old description',current.description==='one'?'two':'one'].sort());
});
test('managed callback retry discards rolled-back revisions and appends activity once', async t => {
  const repo=createEventRevisionRepository(driver); const original=repo.recordChanges; let attempts=0;
  t.mock.method(repo,'recordChanges',async (...args: Parameters<typeof original>) => {
    const result=await original(...args);
    if(++attempts===1)throw new Neo4jError('injected retry','Neo.TransientError.Transaction.DeadlockDetected', '50N42', 'injected transient failure');
    return result;
  });
  const result=await edit({repository:repo});assert.equal(result.errors,undefined,JSON.stringify(result.errors));assert.equal(attempts,2);
  assert.equal((await state()).titles.length,1);
  assert.equal((await driver.executeQuery('MATCH(a:ModerationAction) RETURN count(a) AS n')).records[0].get('n').toNumber(),2);
});
test('unauthorized, unchanged and unmatched edits produce no revisions', async () => {
  assert.ok((await edit({unauthorized:true})).errors?.length);
  assert.equal((await edit({title:'old title',description:'old description'})).errors,undefined);
  assert.equal((await edit({where:{id:{eq:'e'}, title:{eq:'not the title'}}})).errors,undefined);
  assert.deepEqual((await state()).titles,[]);
  assert.deepEqual((await state()).descriptions,[]);
});
test('GraphQL response serialization failure keeps the committed edit and revisions',async () => {
  await driver.executeQuery("MATCH(e:Event {id:'e'}) SET e.canceled=null");
  const result=await edit({projection:'canceled'});assert.ok(result.errors?.length);
  assert.equal((await state()).title,'new title');assert.equal((await state()).titles.length,1);
});

test('public aliases, fragments, variables and response statistics survive postcommit projection', async () => {
  const result = await graphql({schema,
    source:`mutation Edit($show:Boolean!, $__atomicEventIds:String!) {
      updateEvents(where:{id:{eq:"e"}},update:{title:{set:$__atomicEventIds}}) {
        changed: events { ...Details history:PastTitleVersions @include(if:$show) { body } }
        info { nodesCreated relationshipsCreated }
      }
    } fragment Details on Event { id title }`,
    variableValues:{show:true,__atomicEventIds:'aliased title'},
    contextValue:{driver,req:{headers:{}},user:{username:'poster',data:{}}},
  });
  assert.equal(result.errors,undefined,JSON.stringify(result.errors));
  const payload=(result.data as any).updateEvents;
  assert.equal(payload.changed[0].title,'aliased title');
  assert.equal(payload.changed[0].history[0].body,'old title');
  assert.equal(payload.info.nodesCreated,0);
  assert.equal(payload.info.relationshipsCreated,0);
});

for (const fail of [false,true]) test(`custom event/channel mutation commits history with its other writes (fail=${fail})`, async t => {
  await driver.executeQuery("CREATE(:Channel {uniqueName:'forum'})");
  const repo=createEventRevisionRepository(driver);
  if(fail) {
    const original=repo.recordChanges;
    t.mock.method(repo,'recordChanges',async (...args:Parameters<typeof original>) => {await original(...args);throw Error('custom write failure');});
  }
  const resolve=getUpdateEvent({driver,dependencies:{buildEventUpdateNotificationPayload:()=>null}});
  const pending=resolve(null,{where:{id:{eq:'e'}},eventUpdateInput:{title:{set:'custom title'}},channelConnections:['forum'],channelDisconnections:[]},
    {driver,user:{username:'poster',data:{}},eventRevisionRepository:repo} as any,{} as any);
  if(fail)await assert.rejects(pending,/custom write failure/);
  else assert.equal((await pending).title,'custom title');
  const current=await state();assert.equal(current.title,fail?'old title':'custom title');
  assert.equal(current.titles.length,fail?0:1);
  const links=(await driver.executeQuery("MATCH(:EventChannel)-[:POSTED_IN_CHANNEL]->(:Event {id:'e'}) RETURN count(*) AS n")).records[0].get('n').toNumber();
  assert.equal(links,fail?0:1);
});
