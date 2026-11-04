import {graphql} from 'graphql';
import assert from 'node:assert/strict';
import {before,beforeEach,after,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import type {GraphQLSchema,GraphQLObjectType} from 'graphql';
import type {GraphQLContext} from '../../types/context.js';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createBotCommentRepository} from '../../services/persistence/botCommentRepository.js';
import {createBotComment} from '../../services/botUserService.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
import {mock} from 'node:test';
import http from 'node:http';
import https from 'node:https';
const denyExternalHttp=()=>{let n=0;const deny=()=>{n++;throw new Error('external HTTP forbidden');};const guards=[mock.method(globalThis,'fetch',deny),mock.method(http,'request',deny),mock.method(https,'request',deny)];return{assertUnused(){assert.equal(n,0);},restore(){for(const g of guards)g.mock.restore();}};};
let driver:Driver;let schema:GraphQLSchema;let guard:ReturnType<typeof denyExternalHttp>;
const engine=createSubscriptionEngine();let events:unknown[]=[];
for(const kind of ['create','update','create_relationship','delete_relationship','delete'])engine.events.on(kind,(event: unknown)=>events.push(event));
before(async()=>{driver=await startNeo4j();const app=getCustomResolvers(driver);const neo=new Neo4jGraphQL({typeDefs,driver,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine as unknown as boolean}});schema=await neo.getSchema();registerGeneratedSchema(driver,schema);guard=denyExternalHttp();},{timeout:240000});
beforeEach(async()=>{await resetDatabase(driver);events=[];});
after(async()=>{guard?.assertUnused();guard?.restore();await engine.close();await stopNeo4j();});
const normalize=(x:unknown)=>JSON.parse(JSON.stringify(x,function(key,value){if(['createdAt','timestamp','updatedAt','lockedAt'].includes(key))return value===null?null:'<time>';if(value&&typeof value==='object'&&'year' in value&&'nanosecond' in value)return '<time>';return ['id','id_from','id_to'].includes(key)&&this.event?'<generated-event-id>':value;}));
const seed=async()=>driver.executeQuery("CREATE (:Channel {uniqueName:'cats',createdAt:datetime('2020-01-01')}),(:Comment {id:'parent',text:'Parent',isRootComment:true,createdAt:datetime('2020-01-01')}),(:DiscussionChannel {id:'dc',channelUniqueName:'cats'}),(:Event {id:'event',title:'Event'})");
const state=async()=>{const r=await driver.executeQuery("MATCH (c:Comment {text:'Bot text'}) OPTIONAL MATCH (u:User)-[:AUTHORED_COMMENT]->(c) OPTIONAL MATCH (ch:Channel)-[:HAS_COMMENT]->(c) OPTIONAL MATCH (c)-[:IS_REPLY_TO]->(p:Comment) OPTIONAL MATCH (dc:DiscussionChannel)-[:CONTAINS_COMMENT]->(c) OPTIONAL MATCH (e:Event)-[:HAS_COMMENT]->(c) RETURN c.id AS id,c.isRootComment AS root,c.isFeedbackComment AS feedback,u.username AS author,ch.uniqueName AS channel,p.id AS parent,dc.id AS discussion,e.id AS event");return r.records.map(r=>r.toObject());};
const withId=(value:unknown,id:string)=>normalize(JSON.parse(JSON.stringify(value,(_key,v)=>v===id?'<created-comment>':v)));
test('bot comment full default response and all owned connections',async()=>{for(const commentRepository of [createBotCommentRepository(driver)]){await resetDatabase(driver);await seed();events=[];const result=await createBotComment({driver,commentRepository,channelUniqueName:'cats',botName:'helper',text:'Bot text',parentCommentId:'parent',discussionChannelId:'dc',eventId:'event'});assert.ok(result.id);assert.equal(result.isRootComment,false);assert.equal(result.isFeedbackComment,false);const rows=await state();assert.deepEqual(rows,[{id:result.id,root:false,feedback:false,author:'bot-cats-helper',channel:'cats',parent:'parent',discussion:'dc',event:'event'}]);}});
test('missing reply parent fails before bot creation in either implementation',async()=>{for(const commentRepository of [createBotCommentRepository(driver)]){await resetDatabase(driver);await seed();events=[];await assert.rejects(createBotComment({driver,commentRepository,channelUniqueName:'cats',botName:'helper',text:'Bot text',parentCommentId:'missing'}),/Could not find the comment being replied to/);assert.equal(Number((await driver.executeQuery('MATCH (u:User) RETURN count(u) AS n')).records[0].get('n')),0);assert.deepEqual(events,[]);}});
// The owned bot-comment write uses the driver directly (no generated Comment
// projection), so a broken default-field resolver never reaches it: the reply
// still commits with its identity/relationships.
test('owned bot comment write is insulated from a broken default projection resolver',async()=>{const field=(schema.getType('Comment') as GraphQLObjectType).getFields().botMentions;const old=field.resolve;field.resolve=()=>{throw new Error('bot comment projection failure');};try{for(const commentRepository of [createBotCommentRepository(driver)]){await resetDatabase(driver);await seed();events=[];const result=await createBotComment({driver,commentRepository,channelUniqueName:'cats',botName:'helper',text:'Bot text'});assert.ok(result.id);const rows=await state();assert.equal(rows.length,1);assert.equal(rows[0].author,'bot-cats-helper');assert.equal(rows[0].channel,'cats');assert.deepEqual(events,[]);}}finally{field.resolve=old;}});

test('owned bot source completes requested fields without inventing relationship projections',async()=>{
 await seed();
 const source=(await createBotCommentRepository(driver).createReply({text:'source',id:'ignored',isSticky:false,Channel:{connect:{where:{node:{uniqueName:'cats'}}}}})).comments[0];
 assert.notEqual(source.id,'ignored');assert.equal(Object.prototype.hasOwnProperty.call(source,'ageGateTouchedAt'),false);
 assert.equal(Object.prototype.hasOwnProperty.call(source,'CommentAuthor'),false);
 const field=schema.getQueryType()!.getFields().comments, original=field.resolve;
 field.resolve=()=>[source];
 try{
  const result=await graphql({schema,source:'{comments{id text isSticky createdAt CommentAuthor{__typename}}}',contextValue:{driver,req:{headers:{}}}});
  assert.equal(result.errors,undefined,JSON.stringify(result.errors));
  const row=JSON.parse(JSON.stringify(result.data)).comments[0];
  assert.equal(row.id,source.id);assert.equal(row.text,'source');assert.equal(row.isSticky,false);
  assert.equal(typeof row.createdAt,'string');assert.equal(row.CommentAuthor,null);
 }finally{field.resolve=original;}
});
test('owned bot source preserves lazy errors for malformed caller scalar values',async()=>{
 const source=(await createBotCommentRepository(driver).createReply({text:['malformed']})).comments[0];
 const field=schema.getQueryType()!.getFields().comments, original=field.resolve;
 field.resolve=()=>[source];
 try{
  const identity=await graphql({schema,source:'{comments{id}}',contextValue:{driver,req:{headers:{}}}});
  assert.equal(identity.errors,undefined);assert.equal(JSON.parse(JSON.stringify(identity.data)).comments[0].id,source.id);
  const selected=await graphql({schema,source:'{comments{id text}}',contextValue:{driver,req:{headers:{}}}});
  assert.equal(selected.errors?.length,1);assert.deepEqual(selected.errors?.[0].path,['comments',0,'text']);
  assert.deepEqual(JSON.parse(JSON.stringify(selected.data)),{comments:[{id:source.id,text:null}]});
 }finally{field.resolve=original;}
});
