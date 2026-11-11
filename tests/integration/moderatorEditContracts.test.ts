import assert from 'node:assert/strict';
import {after,before,beforeEach,test} from 'node:test';
import {graphql,type GraphQLSchema} from 'graphql';
import {Neo4jGraphQL} from '@neo4j/graphql';
import {applyMiddleware} from 'graphql-middleware';
import jwt from 'jsonwebtoken';
import type {Driver} from 'neo4j-driver';
import typeDefs from '../../typeDefs.js';
import permissions from '../../permissions.js';
import getResolvers from '../helpers/getTestResolvers.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {provisionServerDefaults} from '../../seedData/provisionServerDefaults.js';
import {createServerDefaultsRepository} from '../../services/persistence/serverDefaultsRepository.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver,schema:GraphQLSchema;
before(async()=>{
 process.env.E2E_MOCK_AUTH='true';process.env.SERVER_CONFIG_NAME='moderator-edit-contract';
 driver=await startNeo4j();const generated=await new Neo4jGraphQL({driver,typeDefs,resolvers:getResolvers(driver).resolvers}).getSchema();
 registerGeneratedSchema(driver,generated);schema=applyMiddleware(generated,permissions);
},{timeout:240000});
after(async()=>stopNeo4j());
beforeEach(async()=>{
 await resetDatabase(driver);
 await driver.executeQuery(`CREATE(:ServerConfig{serverName:'moderator-edit-contract'}),
   (a:User{username:'moderator'}),(author:User{username:'author'}),(m:ModerationProfile{displayName:'Editor'}),
   (allowed:Channel{uniqueName:'allowed'}),(denied:Channel{uniqueName:'denied'}),
   (yes:ModChannelRole{canEditComments:true,canEditDiscussions:true,canEditEvents:true}),
   (no:ModChannelRole{canEditComments:false,canEditDiscussions:false,canEditEvents:false})
   CREATE(a)-[:MODERATION_PROFILE]->(m),(allowed)-[:HAS_DEFAULT_MOD_ROLE]->(yes),(denied)-[:HAS_DEFAULT_MOD_ROLE]->(no)
   WITH author UNWIND ['allowed','denied'] AS name MATCH(ch:Channel{uniqueName:name})
   CREATE(author)-[:AUTHORED_COMMENT]->(c:Comment{id:name,text:'original',isRootComment:true,isFeedbackComment:false,createdAt:datetime()}),
     (author)-[:POSTED_DISCUSSION]->(d:Discussion{id:name,title:'original',createdAt:datetime()}),
     (author)-[:POSTED_BY]->(e:Event{id:name,title:'original',createdAt:datetime(),startTime:datetime('2026-11-05T10:00:00Z'),endTime:datetime('2026-11-05T11:00:00Z'),canceled:false}),
     (dc:DiscussionChannel{id:name,discussionId:name,channelUniqueName:name,createdAt:datetime()}),
     (ec:EventChannel{id:name,eventId:name,channelUniqueName:name})
   CREATE(ch)-[:HAS_COMMENT]->(c),(dc)-[:POSTED_IN_CHANNEL]->(d),(dc)-[:POSTED_IN_CHANNEL]->(ch),
     (ec)-[:POSTED_IN_CHANNEL]->(e),(ec)-[:POSTED_IN_CHANNEL]->(ch)`);
 await provisionServerDefaults({repository:createServerDefaultsRepository(driver),serverName:'moderator-edit-contract'});
});
const execute=(source:string,username:string|null='moderator')=>graphql({schema,source,contextValue:{driver,req:{headers:username?{authorization:`Bearer ${jwt.sign({username,email:`${username}@test.invalid`,email_verified:true},'test-only')}`}:{},body:{},isMutation:true}}});
for(const item of [
 {label:'Comment',mutation:'updateComments',field:'comments',property:'text'},
 {label:'Discussion',mutation:'updateDiscussions',field:'discussions',property:'title'},
 {label:'Event',mutation:'updateEvents',field:'events',property:'title'},
]){
 test(`${item.mutation}: permitted moderator edit accepts current scalar ID filter`,async()=>{
  const result=await execute(`mutation {${item.mutation}(where:{id:{eq:"allowed"}},update:{${item.property}:{set:"edited"}}){${item.field}{id}}}`);
  assert.equal(result.errors,undefined,JSON.stringify(result));
  const rows=await driver.executeQuery(`MATCH(n:${item.label}{id:'allowed'}) RETURN n.${item.property} AS value`);
  assert.equal(rows.records[0].get('value'),'edited');
 });
 test(`${item.mutation}: owner access, authentication and missing targets remain intact`,async()=>{
  const operation=(id:string)=>`mutation {${item.mutation}(where:{id:{eq:"${id}"}},update:{${item.property}:{set:"owner edited"}}){${item.field}{id}}}`;
  assert.ok((await execute(operation('allowed'),null)).errors?.length);
  const own=await execute(operation('denied'),'author');assert.equal(own.errors,undefined,JSON.stringify(own));
  assert.ok((await execute(operation('missing'))).errors?.length);
  const rows=await driver.executeQuery(`MATCH(n:${item.label}) RETURN n.id AS id,n.${item.property} AS value ORDER BY n.id`);
  assert.deepEqual(rows.records.map(row=>[row.get('id'),row.get('value')]),[['allowed','original'],['denied','owner edited']]);
 });
 test(`${item.mutation}: membership filters check every candidate channel before writing`,async()=>{
  const invoke=(ids:string[])=>execute(`mutation {${item.mutation}(where:{id:{in:${JSON.stringify(ids)}}},update:{${item.property}:{set:"edited"}}){${item.field}{id}}}`);
  const denied=await invoke(['allowed','denied']);
  assert.ok(denied.errors?.length,JSON.stringify(denied));
  const untouched=await driver.executeQuery(`MATCH(n:${item.label}) RETURN n.${item.property} AS value`);
  assert.deepEqual(untouched.records.map(row=>row.get('value')),['original','original']);
  const allowed=await invoke(['allowed']);
  assert.equal(allowed.errors,undefined,JSON.stringify(allowed));
  const rows=await driver.executeQuery(`MATCH(n:${item.label}{id:'allowed'}) RETURN n.${item.property} AS value`);
  assert.equal(rows.records[0].get('value'),'edited');
 });
 test(`${item.mutation}: alias authorization remains tied to each persisted channel`,async()=>{
  const op=(id:string)=>`${item.mutation}(where:{id:{eq:"${id}"}},update:{${item.property}:{set:"edited"}}){${item.field}{id}}`;
  const result=await execute(`mutation {allowed:${op('allowed')} denied:${op('denied')}}`);
  assert.ok(!result.errors?.some(error=>error.path?.[0]==='allowed'),JSON.stringify(result));
  assert.ok(result.errors?.some(error=>error.path?.[0]==='denied'),JSON.stringify(result));
  const rows=await driver.executeQuery(`MATCH(n:${item.label}) RETURN n.id AS id,n.${item.property} AS value ORDER BY n.id`);
  assert.deepEqual(rows.records.map(row=>[row.get('id'),row.get('value')]),[['allowed','edited'],['denied','original']]);
 });
}

test('moderator edit continues to honor active channel suspensions',async()=>{
 await driver.executeQuery(`MATCH(m:ModerationProfile{displayName:'Editor'}),(ch:Channel{uniqueName:'allowed'})
   CREATE(s:Suspension{id:'suspended-editor',modProfileName:'Editor',suspendedIndefinitely:true})
   CREATE(m)-[:SUSPENDED_AS_MOD]->(s),(ch)-[:SUSPENDED_AS_MOD]->(s)`);
 const result=await execute(`mutation {updateComments(where:{id:{eq:"allowed"}},update:{text:{set:"edited"}}){comments{id}}}`);
 assert.ok(result.errors?.length,JSON.stringify(result));
 const rows=await driver.executeQuery("MATCH(c:Comment{id:'allowed'}) RETURN c.text AS text");assert.equal(rows.records[0].get('text'),'original');
});

for(const item of [
 {label:'Discussion',mutation:'updateDiscussionWithChannelConnections',input:'discussionUpdateInput'},
 {label:'Event',mutation:'updateEventWithChannelConnections',input:'eventUpdateInput'},
]) test(`${item.mutation}: moderator equality filter reaches the application-owned write`,async()=>{
 const result=await execute(`mutation {${item.mutation}(where:{id:{eq:"allowed"}},${item.input}:{title:{set:"custom edit"}},channelConnections:[],channelDisconnections:[]){id title}}`);
 assert.equal(result.errors,undefined,JSON.stringify(result));
 const rows=await driver.executeQuery(`MATCH(n:${item.label}{id:'allowed'}) RETURN n.title AS title`);
 assert.equal(rows.records[0].get('title'),'custom edit');
});

test('moderator event updates preserve links for omitted/null lists and record successful revisions',async()=>{
 const cases=['',',channelConnections:null,channelDisconnections:null',',channelConnections:[]'];
 for(const [index,fields] of cases.entries()){
  const title=`edit ${index}`;
  const result=await execute(`mutation {updateEventWithChannelConnections(where:{id:{eq:"allowed"}},eventUpdateInput:{title:{set:"${title}"}}${fields}){id title}}`);
  assert.equal(result.errors,undefined,JSON.stringify(result));
  const rows=await driver.executeQuery("MATCH(e:Event{id:'allowed'}) RETURN e.title AS title,COUNT {(:TextVersion)} AS versions,[(e)<-[:POSTED_IN_CHANNEL]-(ec:EventChannel) | ec.id] AS channels");
  assert.equal(rows.records[0].get('title'),title);
  assert.equal(Number(rows.records[0].get('versions')),index+1);
  assert.deepEqual(rows.records[0].get('channels'),['allowed']);
 }
 const denied=await execute(`mutation {updateEventWithChannelConnections(where:{id:{eq:"denied"}},eventUpdateInput:{title:{set:"denied edit"}},channelConnections:null,channelDisconnections:null){id}}`);
 assert.ok(denied.errors?.length);
 const row=(await driver.executeQuery("MATCH(e:Event{id:'denied'}) RETURN e.title AS title")).records[0];
 assert.equal(row.get('title'),'original');
});
