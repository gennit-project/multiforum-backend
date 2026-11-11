import {getEventCommentsMetadataQuery} from '../../customResolvers/cypher/cypherQueries.js';
import type {EventMetadataSource} from '../../customResolvers/contracts/eventMetadataSource.js';
import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import {graphql,type GraphQLSchema} from 'graphql';
import {applyMiddleware} from 'graphql-middleware';
import type {Driver} from 'neo4j-driver';
import typeDefs from '../../typeDefs.js';
import getResolvers from '../helpers/getTestResolvers.js';
import middleware from '../../middleware/userChildIdentityMiddleware.js';
import permissions from '../../permissions.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver,schema:GraphQLSchema;
before(async()=>{driver=await startNeo4j();const raw=await new Neo4jGraphQL({driver,typeDefs,resolvers:getResolvers(driver).resolvers}).getSchema();schema=applyMiddleware(raw,middleware,permissions);},{timeout:240000});
after(async()=>stopNeo4j());
beforeEach(async()=>{await resetDatabase(driver);await driver.executeQuery(`CREATE(e:Event{id:'event',title:'Title',description:'Description'}),(u:User{username:'alice',discussionKarma:7,commentKarma:3}),(u)-[:POSTED_BY]->(e),
 (tag:Tag{text:'topic'}),(e)-[:HAS_TAG]->(tag),(ch:Channel{uniqueName:'forum',displayName:'Forum'}),(ec:EventChannel{id:'post',eventId:'event',channelUniqueName:'forum'}),
 (ec)-[:POSTED_IN_CHANNEL]->(ch),(ec)-[:POSTED_IN_CHANNEL]->(e),(u)-[:SUBSCRIBED_TO_NOTIFICATIONS]->(e)`);});
const run=(fields:string,variables?:Record<string,unknown>,username:string|null='alice')=>graphql({schema,source:`query($show:Boolean=true){getEventComments(eventId:"event",sort:new){Event{${fields}}}}`,variableValues:variables,contextValue:{driver,req:{headers:{}},mayAccessSensitiveContent:false,user:username?{username,email:null,email_verified:true,data:null}:null}});
const plain=(value:unknown)=>JSON.parse(JSON.stringify(value));
test('event metadata scalar aliases retain their canonical fields',async()=>{
 const result=await run('id:title title:id @include(if:$show)');assert.equal(result.errors,undefined);
 assert.deepEqual(plain(result.data),{getEventComments:{Event:{id:'Title',title:'event'}}});
});
test('event metadata independent subscription aliases keep their own membership',async()=>{
 const result=await run('SubscribedToEventUpdates:SubscribedToNotifications{username} SubscribedToNotifications:SubscribedToEventUpdates @include(if:$show){username}');assert.equal(result.errors,undefined);
 assert.deepEqual(plain(result.data),{getEventComments:{Event:{SubscribedToEventUpdates:[{username:'alice'}],SubscribedToNotifications:[]}}});
});
test('event metadata preserves nested poster and channel aliases',async()=>{
 const result=await run('Poster{commentKarma:discussionKarma discussionKarma:commentKarma} EventChannels @include(if:$show){id:eventId eventId:id Channel{uniqueName:displayName displayName:uniqueName}}');assert.equal(result.errors,undefined);
 assert.deepEqual(plain(result.data),{getEventComments:{Event:{Poster:{commentKarma:7,discussionKarma:3},EventChannels:[{id:'event',eventId:'post',Channel:{uniqueName:'Forum',displayName:'forum'}}]}}});
});
test('event metadata preserves the native point conversion under an alias',async()=>{
 await driver.executeQuery('MATCH(e:Event) SET e.location=point({latitude:12.5,longitude:35.25})');
 const result=await run('place:location @include(if:$show){latitude longitude srid}');assert.equal(result.errors,undefined);
 assert.deepEqual(plain(result.data),{getEventComments:{Event:{place:{latitude:12.5,longitude:35.25,srid:4326}}}});
});
test('event poster protected children use raw identity without username selection',async()=>{
 const fields='Poster @include(if:$show){hidden:Email{address}}';
 const owner=await run(fields);assert.equal(owner.errors,undefined);
 const outsider=await run(fields,undefined,'outsider');assert.ok(outsider.errors?.some(error=>error.path?.includes('hidden')));
 await driver.executeQuery("MATCH(u:User{username:'alice'}) SET u.username=17");
 const malformed=await run(fields,undefined,'17');assert.ok(malformed.errors?.some(error=>error.path?.includes('hidden')));
});
test('event metadata keeps skipped malformed scalars lazy',async()=>{
 await driver.executeQuery("MATCH(e:Event) SET e.title=['invalid']");
 const fields='id bad:title @include(if:$show)';
 assert.equal((await run(fields,{show:false})).errors,undefined);
 const result=await run(fields,{show:true});assert.ok(result.errors?.some(error=>JSON.stringify(error.path)===JSON.stringify(['getEventComments','Event','bad'])));
});
test('event metadata keeps absent posters and tags nullable or empty',async()=>{
 await driver.executeQuery('MATCH()-[r:POSTED_BY|HAS_TAG]->() DELETE r');
 const result=await run('Poster @include(if:$show){username} Tags{text}');assert.equal(result.errors,undefined);
 assert.deepEqual(plain(result.data),{getEventComments:{Event:{Poster:null,Tags:[]}}});
});
test('event channel missing nested channel stays nullable when requested',async()=>{
 await driver.executeQuery('MATCH(ch:Channel) DETACH DELETE ch');
 const fields='EventChannels{id Channel @include(if:$show){uniqueName}}';
 assert.equal((await run(fields,{show:false})).errors,undefined);
 const selected=await run(fields,{show:true});assert.equal(selected.errors,undefined);
 assert.deepEqual(plain(selected.data),{getEventComments:{Event:{EventChannels:[{id:'post',Channel:null}]}}});
});
test('event metadata subscriptions stay viewer-specific for anonymous and unrelated callers',async()=>{
 for(const username of [null,'outsider']){
  const result=await run('SubscribedToNotifications @include(if:$show){username} SubscribedToEventUpdates{username}',undefined,username);
  assert.equal(result.errors,undefined);
  assert.deepEqual(plain(result.data),{getEventComments:{Event:{SubscribedToNotifications:[],SubscribedToEventUpdates:[]}}});
 }
});
test('event metadata uses the actual fixed query projection',async()=>{
 const session=driver.session();try{
  const result=await session.run<{Event:EventMetadataSource}>(getEventCommentsMetadataQuery,{eventId:'event',loggedInUsername:'alice'});
  const source=result.records[0].get('Event');
  assert.deepEqual(Object.keys(source).sort(),['id','title','description','startTime','endTime','locationName','address','virtualEventUrl','startTimeDayOfWeek','startTimeHourOfDay','canceled','isHostedByOP','isAllDay','coverImageURL','createdAt','updatedAt','isInPrivateResidence','location','cost','Tags','EventChannels','SubscribedToNotifications','SubscribedToEventUpdates','Poster'].sort());
  assert.deepEqual(Object.keys(source.Tags[0]),['text']);
  assert.deepEqual(Object.keys(source.EventChannels[0]).sort(),['id','eventId','channelUniqueName','Channel'].sort());
  assert.ok(source.EventChannels[0].Channel);assert.deepEqual(Object.keys(source.EventChannels[0].Channel).sort(),['uniqueName','displayName','channelIconURL'].sort());
  assert.ok(source.Poster);assert.deepEqual(Object.keys(source.Poster).sort(),['username','createdAt','discussionKarma','commentKarma'].sort());
  assert.deepEqual(source.SubscribedToNotifications,[{username:'alice'}]);assert.deepEqual(source.SubscribedToEventUpdates,[]);
 }finally{await session.close();}
});
test('event metadata aliases and fragments preserve omitted nullable properties',async()=>{
 const result=await graphql({schema,source:'query($show:Boolean!){getEventComments(eventId:"event",sort:new){Event{...Meta}}} fragment Meta on Event{label:title address @include(if:$show) Tags{text}}',variableValues:{show:true},contextValue:{driver,req:{headers:{}},mayAccessSensitiveContent:false}});
 assert.equal(result.errors,undefined);assert.deepEqual(plain(result.data),{getEventComments:{Event:{label:'Title',address:null,Tags:[{text:'topic'}]}}});
});
