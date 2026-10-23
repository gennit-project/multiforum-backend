import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver,ManagedTransaction} from 'neo4j-driver';
import type {GraphQLSchema,GraphQLObjectType} from 'graphql';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createEventWriteRepository,EVENT_UPDATE_SNAPSHOT_SELECTION,UPDATED_EVENT_SELECTION} from '../../services/persistence/eventWriteRepository.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver;let app:ReturnType<typeof getCustomResolvers>;let schema:GraphQLSchema;let events:unknown[]=[];const engine=createSubscriptionEngine();
for(const kind of ['update','create','create_relationship','delete_relationship'])engine.events.on(kind,(event: unknown)=>events.push(event));
before(async()=>{driver=await startNeo4j();app=getCustomResolvers(driver);const neo=new Neo4jGraphQL({driver,typeDefs,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine}});schema=await neo.getSchema();registerGeneratedSchema(driver,schema);},{timeout:240000});
beforeEach(async()=>{await resetDatabase(driver);events=[];});after(async()=>{await engine.close();await stopNeo4j();});
const seed=()=>driver.executeQuery("CREATE(:Event{id:'d',title:'Before',description:'old',canceled:false,startTime:datetime('2026-06-01T10:00:00Z'),endTime:datetime('2026-06-01T12:00:00Z'),createdAt:datetime('2020-01-01T00:00:00Z')})");
const newUpdate=(tx:ManagedTransaction,update:unknown)=>createEventWriteRepository(driver).updateWithinTransaction({id:'d'},update as never,tx);
const title=async()=> (await driver.executeQuery("MATCH(d:Event{id:'d'}) RETURN d.title AS title")).records[0].get('title');
const normalize=(value:unknown)=>{const ids=new Map<string,string>();return JSON.parse(JSON.stringify(value,function(key,value){if(this.event&&['id','id_from','id_to'].includes(key)){const identity=(key==='id'&&this.event.includes('relationship')?'relationship':'node')+':'+value;if(!ids.has(identity))ids.set(identity,`id${ids.size}`);return ids.get(identity);}return ['timestamp','updatedAt'].includes(key)?'<time>':value;}));};
// Both implementations stamp these fields at transaction time. Check their raw
// values before aliasing clocks across independently executed transactions.
function assertNativeUpdateEvent() {
  assert.equal(events.length, 1);
  const event = events[0] as {
    event: string; typename: string; timestamp: number;
    properties: {old: Record<string, unknown>; new: Record<string, unknown>};
  };
  assert.equal(event.event, 'update');
  assert.equal(event.typename, 'Event');
  assert.equal(event.properties.old.title, 'Before');
  assert.equal(event.properties.new.title, 'After');
  assert.equal(event.properties.old.id, 'd');
  assert.equal(event.properties.new.id, 'd');
  const updatedAt = event.properties.new.updatedAt as {toStandardDate(): Date};
  assert.ok(updatedAt && typeof updatedAt.toStandardDate === 'function');
  assert.equal(updatedAt.toStandardDate().getTime(), event.timestamp);
}
test('snapshot and final refetch preserve missing rows and full selected response',async(t)=>{const repo=createEventWriteRepository(driver);assert.deepEqual(await repo.findUpdateSnapshot({id:'missing'}),[]);assert.deepEqual(await repo.findUpdatedEvent('missing'),[]);await seed();t.assert.snapshot(await repo.findUpdateSnapshot({id:'d'}));t.assert.snapshot(await repo.findUpdatedEvent('d'));});
for(const abort of [false,true])test(`caller owns transaction ${abort?'rollback':'commit'} and native event behavior`,async(t)=>{{await resetDatabase(driver);await seed();events=[];const session=driver.session();try{const operation=session.executeWrite(async tx=>{await newUpdate(tx,{title:'After'});assert.equal((await tx.run("MATCH(d:Event{id:'d'}) RETURN d.title AS title")).records[0].get('title'),'After');if(abort)throw Error('fixture abort');});if(abort)await assert.rejects(operation,{message:'fixture abort'});else await operation;}finally{await session.close();}assert.equal(await title(),abort?'Before':'After');assertNativeUpdateEvent();assert.ok(events.length>0);t.assert.snapshot(normalize(events));}});
test('generated input coercion fails with the same error and no mutation',async()=>{await seed();const session=driver.session();try{await assert.rejects(session.executeWrite(tx=>newUpdate(tx,{title:123})),/String cannot represent a non string value/);}finally{await session.close();}assert.equal(await title(),'Before');assert.deepEqual(events,[]);});
test('default projection failure rolls back within caller transaction with legacy event behavior',async(t)=>{const field=(schema.getType('Event') as GraphQLObjectType).getFields().title;const original=field.resolve;field.resolve=()=>{throw Error('fixture projection failure');};try{{await resetDatabase(driver);await seed();events=[];const session=driver.session();try{await assert.rejects(session.executeWrite(tx=>newUpdate(tx,{title:'After'})),{message:'fixture projection failure'});}finally{await session.close();}assert.equal(await title(),'Before');assertNativeUpdateEvent();t.assert.snapshot(normalize(events));}}finally{field.resolve=original;}});

const eventInput = {title: 'Created', canceled: false, startTime: '2026-06-01T10:00:00Z', endTime: '2026-06-01T12:00:00Z'};
const newCreate =(tx: ManagedTransaction, input: unknown) => createEventWriteRepository(driver).createWithinTransaction(input as never, tx);
for (const abort of [false, true]) test(`creation preserves caller-owned ${abort ? 'rollback' : 'commit'}, projection and native events`, async (t) => {
  {
    await resetDatabase(driver); events = [];
    const session = driver.session();
    let createdId = '';
    let response: unknown;
    try {
      const operation = session.executeWrite(async tx => {
        const created = await newCreate(tx, eventInput);
        createdId = created[0].id; response = created;
        const stored = (await tx.run('MATCH(e:Event {id:$id}) RETURN properties(e) AS properties, toString(id(e)) AS id', {id: createdId})).records[0];
        assert.equal(events.length, 1);
        const event = events[0] as {event: string; typename: string; id: string; properties: {old?: unknown; new: unknown}};
        assert.equal(event.event, 'create'); assert.equal(event.typename, 'Event');
        assert.equal(event.id, stored.get('id'));
        assert.equal(event.properties.old, undefined);
        assert.deepEqual(event.properties.new, stored.get('properties'));
        if (abort) throw Error('fixture abort');
      });
      if (abort) await assert.rejects(operation, {message: 'fixture abort'}); else await operation;
    } finally { await session.close(); }
    const repo = createEventWriteRepository(driver);
    const fetched = await repo.findCreatedEvent(createdId);
    assert.equal(fetched.length, abort ? 0 : 1);
    if (!abort) t.assert.snapshot(JSON.parse(JSON.stringify(fetched, (key, value) => value === createdId ? '<createdId>' : key === 'createdAt' ? '<createdAt>' : value)));
    const actual = normalize(JSON.parse(JSON.stringify({response, events}, (key, value) => value === createdId ? '<createdId>' : key === 'createdAt' ? '<createdAt>' : value)));
    t.assert.snapshot(actual);
  }
});
test('creation input coercion has matching errors without writes or events', async () => {
  const session = driver.session();
  try {
    await assert.rejects(session.executeWrite(tx => newCreate(tx, {...eventInput, canceled: 'invalid'})), /Boolean cannot represent a non boolean value/);
  } finally { await session.close(); }
  assert.deepEqual(events, []);
  assert.equal((await driver.executeQuery('MATCH(e:Event) RETURN count(e) AS n')).records[0].get('n').toNumber(), 0);
});
test('creation projection failure preserves native publication and rolls back the caller transaction', async (t) => {
  const field = (schema.getType('Event') as GraphQLObjectType).getFields().title;
  const original = field.resolve; field.resolve = () => {throw Error('fixture projection failure');};
  try {
    {
      await resetDatabase(driver); events = [];
      const session = driver.session();
      try { await assert.rejects(session.executeWrite(tx => newCreate(tx, eventInput)), {message: 'fixture projection failure'}); }
      finally { await session.close(); }
      assert.equal((await driver.executeQuery('MATCH(e:Event) RETURN count(e) AS n')).records[0].get('n').toNumber(), 0);
      assert.equal(events.length, 1);
      const event = events[0] as {event: string; properties: {new: {id: string; title: string}}};
      assert.equal(event.event, 'create'); assert.equal(event.properties.new.title, 'Created');
      const actual = normalize(JSON.parse(JSON.stringify(events, (key, value) => value === event.properties.new.id ? '<createdId>' : key === 'createdAt' ? '<createdAt>' : value)));
      t.assert.snapshot(actual);
    }
  } finally {field.resolve = original;}
});
