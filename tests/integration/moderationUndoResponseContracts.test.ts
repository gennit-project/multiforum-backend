import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { graphql, type GraphQLSchema } from "graphql";
import { applyMiddleware } from "graphql-middleware";
import type { Driver } from "neo4j-driver";
import typeDefs from "../../typeDefs.js";
import getResolvers from "../helpers/getTestResolvers.js";
import permissions from "../../permissions.js";
import undo from "../../customResolvers/mutations/undoSuperUpvote.js";
import { createSuperVoteUndoRepository } from "../../services/persistence/superVoteUndoRepository.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { startNeo4j, stopNeo4j, resetDatabase } from "./neo4jHarness.js";
let driver:Driver,schema:GraphQLSchema,secured:GraphQLSchema;
let fault:""|"read"|"karma"|"username"|"many"="";
let reads=0;
before(async()=>{
 driver=await startNeo4j();const repository=createSuperVoteUndoRepository(driver);
 async function afterRead(){
  reads++;if(fault==='read')throw Error('injected snapshot failure');
  if(fault==='karma')await driver.executeQuery("MATCH(a:User {username:'author'}) SET a.commentKarma='bad'");
  if(fault==='username')await driver.executeQuery("MATCH(u:User {username:'remaining'}) SET u.username=['bad']");
  if(fault==='many')await driver.executeQuery("MATCH(c:Comment {id:'c'}) UNWIND range(1,30) AS n CREATE(u:User {username:'extra'+toString(n)}) CREATE(u)-[:SUPER_UPVOTED_COMMENT]->(c)");
 }
 const resolve=undo({driver,repository:{findComment:async id=>{const rows=await repository.findComment(id);await afterRead();return rows;},findDiscussion:async id=>{const rows=await repository.findDiscussion(id);await afterRead();return rows;}}});
 const app=getResolvers(driver);
 schema=await new Neo4jGraphQL({driver,typeDefs,resolvers:{...app.resolvers,Mutation:{...app.resolvers.Mutation,undoSuperUpvote:resolve}},features:{filters:{String:{MATCHES:true}}}}).getSchema();
 registerGeneratedSchema(driver,schema);secured=applyMiddleware(schema,permissions);
},{timeout:240000});
after(async()=>stopNeo4j());
beforeEach(async()=>{
 await resetDatabase(driver);fault="";reads=0;
 await driver.executeQuery(`CREATE(a:User {username:'author',commentKarma:7,discussionKarma:7,createdAt:datetime()}),
 (v:User {username:'voter',createdAt:datetime()}),(r:User {username:'remaining',createdAt:datetime()}),
 (ch:Channel {uniqueName:'forum',createdAt:datetime()}),(c:Comment {id:'c',weightedVotesCount:2,createdAt:datetime()}),
 (d:Discussion {id:'d',title:'Discussion',createdAt:datetime()}),(dc:DiscussionChannel {id:'dc',channelUniqueName:'forum',weightedVotesCount:2,createdAt:datetime()})
 CREATE(a)-[:AUTHORED_COMMENT]->(c) CREATE(a)-[:POSTED_DISCUSSION]->(d) CREATE(dc)-[:POSTED_IN_CHANNEL]->(d) CREATE(dc)-[:POSTED_IN_CHANNEL]->(ch)
 CREATE(ch)-[:HAS_COMMENT]->(c) CREATE(v)-[:ADMIN_OF_CHANNEL]->(ch)
 CREATE(v)-[:SUPER_UPVOTED_COMMENT]->(c) CREATE(r)-[:SUPER_UPVOTED_COMMENT]->(c) CREATE(v)-[:SUPER_UPVOTED_DISCUSSION]->(dc)
 CREATE(v)-[:WROTE_SCRATCHPAD_ENTRY]->(:ScratchpadEntry {id:'entry',sourceType:'comment',sourceId:'c'})`);
});
const fields='success message sourceId sourceType';
function execute(type='comment',id='c',selection=fields,username:string|null='voter',secure=true){return graphql({schema:secure?secured:schema,source:`mutation{undoSuperUpvote(sourceType:${JSON.stringify(type)},sourceId:${JSON.stringify(id)}){${selection}}}`,contextValue:{driver,req:{headers:{}},user:username?{username,email:null,email_verified:true,data:{ModerationProfile:null}}:undefined}});}
const plain=(x:unknown)=>JSON.parse(JSON.stringify(x));
async function state(){const row=(await driver.executeQuery("MATCH(a:User {username:'author'}),(c:Comment {id:'c'}),(dc:DiscussionChannel {id:'dc'}) RETURN a.commentKarma AS ck,a.discussionKarma AS dk,c.weightedVotesCount AS cw,dc.weightedVotesCount AS dw,COUNT {(:User {username:'voter'})-[:SUPER_UPVOTED_COMMENT]->(c)} AS commentVotes,COUNT {(:ScratchpadEntry)} AS entries")).records[0];return Object.fromEntries(['ck','dk','cw','dw','commentVotes','entries'].map(k=>[k,Number(row.get(k))]));}
for(const sourceType of ['comment','discussion'])test(`${sourceType} checked response, selected users, repeat error and durable karma`,async()=>{
 const id=sourceType==='comment'?'c':'dc';const result=await execute(sourceType,id,fields+' superUpvotedByUsers{username}');assert.equal(result.errors,undefined);
 assert.deepEqual(plain(result.data).undoSuperUpvote,{success:true,message:'Super upvote removed successfully',sourceId:id,sourceType,superUpvotedByUsers:sourceType==='comment'?[{username:'remaining'}]:[]});
 const persisted=await state();assert.equal(persisted[sourceType==='comment'?'ck':'dk'],6);assert.equal(persisted[sourceType==='comment'?'cw':'dw'],1);
 if(sourceType==='comment')assert.equal(persisted.entries,0);
 assert.match((await execute(sourceType,id)).errors?.[0].message??'',/not super upvoted/);
});
test('authentication and channel permission failures prevent snapshot and writes',async()=>{
 const before=await state();assert.ok((await execute('comment','c',fields,null)).errors);assert.ok((await execute('comment','c',fields,'remaining')).errors);assert.equal(reads,0);assert.deepEqual(await state(),before);
});
test('missing/invalid source and snapshot failures preserve state',async()=>{
 const before=await state();assert.match((await execute('comment','missing',fields,'voter',false)).errors?.[0].message??'',/Comment not found/);
 assert.match((await execute('invalid','c',fields,'voter',false)).errors?.[0].message??'',/sourceType must/);
 fault='read';assert.match((await execute()).errors?.[0].message??'',/injected snapshot failure/);assert.deepEqual(await state(),before);
});
test('write failure rolls back vote, weight and scratchpad deletion',async()=>{
 fault='karma';assert.ok((await execute()).errors);const after=await state();assert.equal(after.cw,2);assert.equal(after.commentVotes,1);assert.equal(after.entries,1);
});
for(const selectUsers of [false,true])test(`raw username corruption after snapshot stays lazy, selected=${selectUsers}`,async()=>{
 fault='username';const result=await execute('comment','c',fields+(selectUsers?' superUpvotedByUsers{username}':''));
 if(selectUsers){assert.match(result.errors?.[0].message??'',/String cannot represent/);assert.deepEqual(result.errors?.[0].path,['undoSuperUpvote','superUpvotedByUsers',0,'username']);}
 else {assert.equal(result.errors,undefined);assert.equal(plain(result.data).undoSuperUpvote.success,true);}
 const after=await state();assert.equal(after.cw,1);assert.equal(after.ck,6);assert.equal(after.commentVotes,0);assert.equal(after.entries,0);
});
test('post-write raw user list remains uncapped independently of the default25 preliminary projection',async()=>{
 fault='many';const result=await execute('comment','c',fields+' superUpvotedByUsers{username}');assert.equal(result.errors,undefined);assert.equal(plain(result.data).undoSuperUpvote.superUpvotedByUsers.length,31);
});
test('nullable content authors skip karma while both votes still undo',async()=>{
 await driver.executeQuery("MATCH(:User {username:'author'})-[r:AUTHORED_COMMENT|POSTED_DISCUSSION]->() DELETE r");
 for(const [type,id] of [['comment','c'],['discussion','dc']]){
  const result=await execute(type,id);assert.equal(result.errors,undefined);assert.equal(plain(result.data).undoSuperUpvote.success,true);
 }
 const after=await state();assert.equal(after.ck,7);assert.equal(after.dk,7);assert.equal(after.cw,1);assert.equal(after.dw,1);
});
