import sourceIdentity from "../../middleware/userChildIdentityMiddleware.js";
import assert from 'node:assert/strict';
import { before, beforeEach, after, test } from 'node:test';
import { Neo4jGraphQL } from '@neo4j/graphql';
import { graphql, defaultFieldResolver, type GraphQLObjectType, type GraphQLSchema } from 'graphql';
import { applyMiddleware } from 'graphql-middleware';
import type { Driver } from 'neo4j-driver';
import typeDefs from '../../typeDefs.js';
import permissions from '../../permissions.js';
import getResolvers from '../helpers/getTestResolvers.js';
import getCreateEventResolver from '../../customResolvers/mutations/createEventWithChannelConnections.js';
import { createEventWriteRepository } from '../../services/persistence/eventWriteRepository.js';
import { registerGeneratedSchema } from '../../services/persistence/generatedSchemaOperations.js';
import { installAgeGateReconcile } from '../../services/ageGate/reconcile.js';
import { getAgeGateStatements } from '../../services/ageGate/definitions.js';
import { startNeo4j, stopNeo4j, resetDatabase } from './neo4jHarness.js';

let driver: Driver, schema: GraphQLSchema;
let failure: 'read' | 'empty' | 'wrong-id' | 'malformed-channel' | undefined;
let failOn = 1, reads = 0, outerFailure = false;
before(async () => {
  driver = installAgeGateReconcile(await startNeo4j(), getAgeGateStatements(typeDefs));
  const repository = createEventWriteRepository(driver);
  const resolvers = getResolvers(driver).resolvers;
  resolvers.Mutation.createEventWithChannelConnections = getCreateEventResolver({ driver, eventWriteRepository: {
    ...repository,
    async findCreatedEvent(id, tx) {
      const selected = ++reads === failOn;
      if (selected && failure === 'malformed-channel') {
        // A database fixture creates a real non-null projection failure after
        // the owned links exist. This is fault injection, not a production-data claim.
        const query = 'MATCH(ec:EventChannel {eventId:$id}) REMOVE ec.createdAt';
        if (tx) await tx.run(query, {id}); else await driver.executeQuery(query, {id});
      }
      const result = await repository.findCreatedEvent(id, tx);
      if (selected && failure === 'read') throw new Error('Fixture response read failure');
      if (selected && failure === 'empty') return [];
      if (selected && failure === 'wrong-id') return [{...result[0], id:'wrong-id'}];
      return result;
    },
  }});
  const raw = await new Neo4jGraphQL({ driver, typeDefs, resolvers, features:{filters:{String:{MATCHES:true}}} }).getSchema();
  const title = (raw.getType('Event') as GraphQLObjectType).getFields().title;
  const resolveTitle=title.resolve ?? defaultFieldResolver;
  title.resolve = (source, args, context, info) => {
    if (outerFailure && !info.operation.name) throw new Error('Fixture outer completion failure');
    return resolveTitle(source,args,context,info);
  };
  registerGeneratedSchema(driver,raw);
  schema = applyMiddleware(raw,permissions,sourceIdentity);
}, {timeout:240_000});
after(async()=>stopNeo4j());
beforeEach(async()=>{
  failure=undefined; failOn=1; reads=0; outerFailure=false;
  await resetDatabase(driver);
  await driver.executeQuery(`CREATE(u:User {username:'alice',createdAt:datetime(),notifyOnReplyToEventByDefault:true}),
    (:User {username:'bob',createdAt:datetime()}), (c:Channel {uniqueName:'forum',eventsEnabled:true}),
    (s:Channel {uniqueName:'second',eventsEnabled:true})
    CREATE(u)-[:ADMIN_OF_CHANNEL]->(c) CREATE(u)-[:ADMIN_OF_CHANNEL]->(s)`);
});
const item=(title='Created')=>({eventCreateInput:{title,canceled:false,startTime:'2026-06-01T10:00:00Z',endTime:'2026-06-01T12:00:00Z',
  Tags:{create:[{node:{text:title}}]}},channelConnections:['forum','second']});
const SOURCE=`mutation($input:[EventCreateInputWithChannels!]!){createEventWithChannelConnections(input:$input){id title canceled startTime endTime Tags{text} EventChannels{id channelUniqueName eventId createdAt archived} SubscribedToNotifications{username}}}`;
const execute=(input:ReturnType<typeof item>[],username='alice')=>graphql({schema,source:SOURCE,variableValues:{input},contextValue:{driver,req:{headers:{}},user:{username,email:null,email_verified:true,data:null}}});
const ok=(result:Awaited<ReturnType<typeof execute>>)=>{assert.equal(result.errors,undefined,JSON.stringify(result.errors));return (result.data as any).createEventWithChannelConnections as Array<{id:string;title:string;Tags:Array<{text:string}>;EventChannels:Array<{channelUniqueName:string;eventId:string}>;SubscribedToNotifications:Array<{username:string}>}>;};
async function persistedTitles(){return (await driver.executeQuery('MATCH(e:Event) RETURN e.title AS title ORDER BY title')).records.map(r=>r.get('title'));}
async function assertEmpty(){assert.equal((await driver.executeQuery('MATCH(n) WHERE n:Event OR n:EventChannel OR n:Tag RETURN n')).records.length,0);}

test('real GraphQL creation returns the saved item, tags, forum links and subscriptions',async()=>{
  const [event]=ok(await execute([item()]));
  assert.equal(event.title,'Created');
  assert.deepEqual(event.Tags.map(t=>t.text),['Created']);
  assert.deepEqual(event.EventChannels.map(c=>c.channelUniqueName).sort(),['forum','second']);
  assert.ok(event.EventChannels.every(c=>c.eventId===event.id));
  assert.deepEqual(event.SubscribedToNotifications.map(u=>u.username),['alice']);
  const stored=(await createEventWriteRepository(driver).findCreatedEvent(event.id))[0];
  assert.equal(stored.title,event.title);
  assert.equal(stored.EventChannels.length,2);
  assert.deepEqual(await createEventWriteRepository(driver).findCreatedEvent('missing'),[]);
});
for(const mode of ['read','empty','wrong-id','malformed-channel'] as const){
  test(`${mode} response failure rolls back the event, tags, subscriptions and forum links`,async()=>{
    failure=mode;
    const result=await execute([item()]);
    await assertEmpty();
    assert.deepEqual(ok(result),[]);
    assert.equal(reads,1);
  });
  test(`${mode} on a middle item preserves earlier success and still creates the later item`,async()=>{
    failure=mode; failOn=2;
    const result=await execute([item('First'),item('Failed'),item('Last')]);
    assert.deepEqual(await persistedTitles(),['First','Last']);
    assert.deepEqual(ok(result).map(e=>e.title),['First','Last']);
    assert.equal(reads,3);
    assert.equal((await driver.executeQuery('MATCH(ec:EventChannel) RETURN ec')).records.length,4);
    assert.deepEqual((await driver.executeQuery('MATCH(t:Tag) RETURN t.text AS text ORDER BY text')).records.map(r=>r.get('text')),['First','Last']);
  });
}
test('anonymous and unauthorized callers cannot create events',async()=>{
  assert.ok((await execute([item()],'')).errors);
  assert.ok((await execute([item()],'bob')).errors);
  await assertEmpty();
  assert.equal(reads,0);
});
test('disabled forum validation still rejects the batch before writes',async()=>{
  await driver.executeQuery('MATCH(c:Channel {uniqueName:"second"}) SET c.eventsEnabled=false');
  assert.ok((await execute([item()])).errors);
  await assertEmpty();
  assert.equal(reads,0);
});
test('outer GraphQL completion remains post-commit and outside the response-read guarantee',async()=>{
  outerFailure=true;
  assert.match(JSON.stringify((await execute([item()])).errors),/Fixture outer completion failure/);
  assert.deepEqual(await persistedTitles(),['Created']);
});

test('event creation aliases preserve fixed response scalars, nested links and subscribers',async()=>{
 const source=`mutation($input:[EventCreateInputWithChannels!]!){result:createEventWithChannelConnections(input:$input){key:id id:title label:title Tags{label:text} links:EventChannels{forum:channelUniqueName Event{key:id} Channel{name:uniqueName}} subscribers:SubscribedToNotifications{name:username}}}`;
 const result=await graphql({schema,source,variableValues:{input:[item()]},contextValue:{driver,req:{headers:{}},user:{username:'alice',email:null,email_verified:true,data:null}}});
 assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 const response=JSON.parse(JSON.stringify(result.data)).result[0];
 assert.equal(response.id,'Created');assert.equal(response.label,'Created');assert.deepEqual(response.Tags,[{label:'Created'}]);assert.deepEqual(response.subscribers,[{name:'alice'}]);
 assert.deepEqual(response.links.map((link:{forum:string})=>link.forum).sort(),['forum','second']);
 assert.ok(response.links.every((link:{Event:{key:string};Channel:{name:string};forum:string})=>link.Event.key===response.key&&link.Channel.name===link.forum));
});
