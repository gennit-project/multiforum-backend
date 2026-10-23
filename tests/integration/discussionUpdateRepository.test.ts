import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver,ManagedTransaction} from 'neo4j-driver';
import type {GraphQLSchema,GraphQLObjectType} from 'graphql';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createDiscussionUpdateRepository} from '../../services/persistence/discussionUpdateRepository.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver;let app:ReturnType<typeof getCustomResolvers>;let schema:GraphQLSchema;let events:unknown[]=[];const engine=createSubscriptionEngine();
for(const kind of ['update','create','create_relationship','delete_relationship'])engine.events.on(kind,event=>events.push(event));
before(async()=>{driver=await startNeo4j();app=getCustomResolvers(driver);const neo=new Neo4jGraphQL({driver,typeDefs,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine}});schema=await neo.getSchema();registerGeneratedSchema(driver,schema);},{timeout:240000});
beforeEach(async()=>{await resetDatabase(driver);events=[];});after(async()=>{await engine.close();await stopNeo4j();});
const seed=()=>driver.executeQuery("CREATE(:Discussion{id:'d',title:'Before',body:'old',createdAt:datetime('2020-01-01T00:00:00Z')})");
const newUpdate=(tx:ManagedTransaction,update:unknown)=>createDiscussionUpdateRepository(driver).updateWithinTransaction({id:'d'},update as never,tx);
const title=async()=> (await driver.executeQuery("MATCH(d:Discussion{id:'d'}) RETURN d.title AS title")).records[0].get('title');
const normalize=(value:unknown)=>{const ids=new Map<string,string>();return JSON.parse(JSON.stringify(value,function(key,value){if(this.event&&['id','id_from','id_to'].includes(key)){const identity=(key==='id'&&this.event.includes('relationship')?'relationship':'node')+':'+value;if(!ids.has(identity))ids.set(identity,`id${ids.size}`);return ids.get(identity);}return ['timestamp','updatedAt','ageGateTouchedAt'].includes(key)?'<time>':value;}));};
// Both implementations stamp these fields at transaction time. Check their raw
// values before aliasing clocks across independently executed transactions.
function assertNativeUpdateEvent() {
  assert.equal(events.length, 1);
  const event = events[0] as {
    event: string; typename: string; timestamp: number;
    properties: {old: Record<string, unknown>; new: Record<string, unknown>};
  };
  assert.equal(event.event, 'update');
  assert.equal(event.typename, 'Discussion');
  assert.equal(event.properties.old.title, 'Before');
  assert.equal(event.properties.new.title, 'After');
  assert.equal(event.properties.old.id, 'd');
  assert.equal(event.properties.new.id, 'd');
  const updatedAt = event.properties.new.updatedAt as {toStandardDate(): Date};
  assert.ok(updatedAt && typeof updatedAt.toStandardDate === 'function');
  assert.deepEqual(event.properties.new.ageGateTouchedAt, updatedAt);
  assert.equal(updatedAt.toStandardDate().getTime(), event.timestamp);
}
test('snapshot and final refetch preserve missing rows and full selected response',async(t)=>{const repo=createDiscussionUpdateRepository(driver);assert.deepEqual(await repo.findRevisionSnapshot({id:'missing'}),[]);assert.deepEqual(await repo.findUpdatedDiscussion('missing'),[]);await seed();t.assert.snapshot(await repo.findRevisionSnapshot({id:'d'}));t.assert.snapshot(await repo.findUpdatedDiscussion('d'));});
for(const abort of [false,true])test(`caller owns transaction ${abort?'rollback':'commit'} and native event behavior`,async(t)=>{{await resetDatabase(driver);await seed();events=[];const session=driver.session();try{const operation=session.executeWrite(async tx=>{await newUpdate(tx,{title:'After'});assert.equal((await tx.run("MATCH(d:Discussion{id:'d'}) RETURN d.title AS title")).records[0].get('title'),'After');if(abort)throw Error('fixture abort');});if(abort)await assert.rejects(operation,{message:'fixture abort'});else await operation;}finally{await session.close();}assert.equal(await title(),abort?'Before':'After');assertNativeUpdateEvent();assert.ok(events.length>0);t.assert.snapshot(normalize(events));}});
test('generated input coercion fails with the same error and no mutation',async()=>{await seed();const session=driver.session();try{await assert.rejects(session.executeWrite(tx=>newUpdate(tx,{title:123})),/String cannot represent a non string value/);}finally{await session.close();}assert.equal(await title(),'Before');assert.deepEqual(events,[]);});
test('default projection failure rolls back within caller transaction with legacy event behavior',async(t)=>{const field=(schema.getType('Discussion') as GraphQLObjectType).getFields().title;const original=field.resolve;field.resolve=()=>{throw Error('fixture projection failure');};try{{await resetDatabase(driver);await seed();events=[];const session=driver.session();try{await assert.rejects(session.executeWrite(tx=>newUpdate(tx,{title:'After'})),{message:'fixture projection failure'});}finally{await session.close();}assert.equal(await title(),'Before');assertNativeUpdateEvent();t.assert.snapshot(normalize(events));}}finally{field.resolve=original;}});
