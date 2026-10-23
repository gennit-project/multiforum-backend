import assert from 'node:assert/strict';
import {before,beforeEach,after,test,mock} from 'node:test';
import http from 'node:http';
import https from 'node:https';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import type {GraphQLObjectType,GraphQLSchema} from 'graphql';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createBotThreadRepository} from '../../services/persistence/botThreadRepository.js';
import {collectParentCommentThread} from '../../services/plugin/buildBotInvocationContext.js';
import {MAX_REPLY_DEPTH} from '../../services/replyAncestry.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let attempts=0;const guards:ReturnType<typeof mock.method>[]=[];const deny=()=>{attempts++;throw new Error('external HTTP forbidden');};
let driver:Driver;let schema:GraphQLSchema;
before(async()=>{driver=await startNeo4j();const app=getCustomResolvers(driver);const neo=new Neo4jGraphQL({typeDefs,driver,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}}}});schema=await neo.getSchema();registerGeneratedSchema(driver,schema);guards.push(mock.method(globalThis,'fetch',deny),mock.method(http,'request',deny),mock.method(https,'request',deny));},{timeout:240000});
beforeEach(async()=>resetDatabase(driver));after(async()=>{assert.equal(attempts,0);for(const g of guards)g.mock.restore();await stopNeo4j();});
test('parent snapshot exact projection, missing, special IDs and author union match production OGM',async(t)=>{
 await driver.executeQuery('CREATE (u:User {username:"alice",displayName:"Alice"}),(m:ModerationProfile {displayName:"Moderator"}),(c:Comment {id:$id,text:"text"}),(p:Comment {id:"parent",text:"older"}) CREATE (u)-[:AUTHORED_COMMENT]->(c) CREATE (m)-[:AUTHORED_COMMENT]->(p) CREATE (u)-[:MODERATION_PROFILE]->(m) CREATE (c)-[:IS_REPLY_TO]->(p)',{id:'quote"\\'});
 const repo=createBotThreadRepository(driver);const row=(await repo.findParent('parent'))[0];assert.equal(row.CommentAuthor?.displayName,'Moderator');assert.equal(row.CommentAuthor?.User?.username,'alice');for(const id of ['quote"\\','parent','missing'])t.assert.snapshot(await repo.findParent(id));
 const field=(schema.getType('Comment') as GraphQLObjectType).getFields().text;const old=field.resolve;field.resolve=()=>{throw new Error('thread projection failure');};try{await assert.rejects(repo.findParent('parent'),{message:'thread projection failure'});}finally{field.resolve=old;}
});
test('cycle and maximum-depth parent walks preserve ordering and truncation',async(t)=>{
 await driver.executeQuery('UNWIND range(0,$depth) AS i CREATE (:Comment {id:toString(i),text:toString(i)})',{depth:MAX_REPLY_DEPTH+2});
 await driver.executeQuery('MATCH (c:Comment),(p:Comment) WHERE toInteger(p.id)=toInteger(c.id)-1 CREATE (c)-[:IS_REPLY_TO]->(p)');
 for(const repository of [createBotThreadRepository(driver)]){const rows=await collectParentCommentThread({repository,parentCommentId:String(MAX_REPLY_DEPTH+2)});assert.equal(rows.length,MAX_REPLY_DEPTH);assert.equal(rows[0].id,'3');assert.equal(rows[rows.length-1].id,String(MAX_REPLY_DEPTH+2));}
 await driver.executeQuery('MATCH (c:Comment {id:"0"}),(p:Comment {id:"1"}) CREATE (c)-[:IS_REPLY_TO]->(p)');
 t.assert.snapshot(await collectParentCommentThread({repository:createBotThreadRepository(driver),parentCommentId:'1'}));
});
