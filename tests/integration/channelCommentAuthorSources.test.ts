import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import type {Driver} from 'neo4j-driver';
import {Neo4jGraphQL} from '@neo4j/graphql';
import {graphql,type GraphQLSchema} from 'graphql';
import {applyMiddleware} from 'graphql-middleware';
import typeDefs from '../../typeDefs.js';
import permissions from '../../permissions.js';
import getResolvers from '../helpers/getTestResolvers.js';
import userChildIdentityMiddleware from '../../middleware/userChildIdentityMiddleware.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver;
let schema:GraphQLSchema;
before(async()=>{
  driver=await startNeo4j();await resetDatabase(driver);
  const raw=await new Neo4jGraphQL({driver,typeDefs,resolvers:getResolvers(driver).resolvers}).getSchema();
  registerGeneratedSchema(driver,raw);schema=applyMiddleware(raw,userChildIdentityMiddleware,permissions);
  await driver.executeQuery(`CREATE(a:User{username:'alice',bio:'alias',createdAt:datetime()}),
    (b:User{username:'bob',bio:'alias',createdAt:datetime()}),
    (m:ModerationProfile{displayName:'Moderator',createdAt:datetime('2026-01-01T00:00:00Z')}),
    (root:Comment{id:'root',text:'root',isRootComment:true,createdAt:datetime()}),
    (own:Comment{id:'a-own',text:'own',isRootComment:false,createdAt:datetime()}),
    (other:Comment{id:'b-other',text:'other',isRootComment:false,createdAt:datetime()}),
    (mod:Comment{id:'c-mod',text:'mod',isRootComment:false,createdAt:datetime()})
    CREATE(ch:Channel{uniqueName:'forum',createdAt:datetime()})
    CREATE(ch)-[:HAS_COMMENT]->(root),(ch)-[:HAS_COMMENT]->(own),(ch)-[:HAS_COMMENT]->(other),(ch)-[:HAS_COMMENT]->(mod)
    CREATE(a)-[:MODERATION_PROFILE]->(m),(m)-[:AUTHORED_COMMENT]->(root),(m)-[:AUTHORED_COMMENT]->(mod),
    (a)-[:AUTHORED_COMMENT]->(own),(b)-[:AUTHORED_COMMENT]->(other),
    (own)-[:IS_REPLY_TO]->(root),(other)-[:IS_REPLY_TO]->(root),(mod)-[:IS_REPLY_TO]->(root),
    (:Email{address:'alice@nested.test'})-[:HAS_EMAIL]->(a),(:Email{address:'bob@nested.test'})-[:HAS_EMAIL]->(b)`);
},{timeout:240000});
after(async()=>stopNeo4j());
const context=(viewer:string|null)=>({driver,req:{headers:{}},user:viewer?{username:viewer,email:null,email_verified:true,data:null}:null});
test('channel comment authors preserve moderator type without selecting displayName',async()=>{
 const response=await graphql({schema,source:'{channels(where:{uniqueName:{eq:"forum"}}){Comments(where:{id:{eq:"root"}}){CommentAuthor{__typename ... on ModerationProfile{createdAt}}}}}',contextValue:context('alice')});
 assert.equal(response.errors,undefined,JSON.stringify(response.errors));
 assert.deepEqual(JSON.parse(JSON.stringify(response.data)),{channels:[{Comments:[{CommentAuthor:{__typename:'ModerationProfile',createdAt:'2026-01-01T00:00:00.000Z'}}]}]});
});
test('channel comment author supplies identity for owner child without selecting username',async()=>{
 const response=await graphql({schema,source:'{channels(where:{uniqueName:{eq:"forum"}}){Comments(where:{id:{eq:"a-own"}}){CommentAuthor{... on User{Email{address}}}}}}',contextValue:context('alice')});
 assert.equal(response.errors,undefined,JSON.stringify(response.errors));
 assert.deepEqual(JSON.parse(JSON.stringify(response.data)),{channels:[{Comments:[{CommentAuthor:{Email:{address:'alice@nested.test'}}}]}]});
});
for(const connection of [false,true])for(const viewer of ['alice','bob',null])test(`channel comment ${connection?'connection':'list'} aliases retain permissions for ${viewer??'anonymous'}`,async()=>{
 const body='posts:Comments(where:{id:{in:["a-own","b-other","c-mod"]}},sort:[{id:ASC}]){id who:CommentAuthor{...Actor}}';
 const source=connection?`query($show:Boolean!=true){page:channelsConnection(where:{uniqueName:{eq:"forum"}}){links:edges{entry:node{${body}}}}}`:`query($show:Boolean!=true){page:channels(where:{uniqueName:{eq:"forum"}}){${body}}}`;
 const response=await graphql({schema,source:source+' fragment Actor on CommentAuthor{kind:__typename ... on User{displayName:bio mail:Email @include(if:$show){address}} ... on ModerationProfile{username:displayName hidden:User{username}}}',contextValue:context(viewer)});
 const posts=[{id:'a-own',who:{kind:'User',displayName:'alias',mail:viewer==='alice'?{address:'alice@nested.test'}:null}},{id:'b-other',who:{kind:'User',displayName:'alias',mail:viewer==='bob'?{address:'bob@nested.test'}:null}},{id:'c-mod',who:{kind:'ModerationProfile',username:'Moderator',hidden:null}}];
 assert.deepEqual(JSON.parse(JSON.stringify(response.data)),connection?{page:{links:[{entry:{posts}}]}}:{page:[{posts}]});
 const prefix=connection?['page','links',0,'entry','posts']:['page',0,'posts'];
 const paths=[...(viewer==='alice'?[]:[[...prefix,0,'who','mail']]),...(viewer==='bob'?[]:[[...prefix,1,'who','mail']]),[...prefix,2,'who','hidden']];
 assert.deepEqual(response.errors?.map(error=>JSON.stringify(error.path)).sort(),paths.map(path=>JSON.stringify(path)).sort(),JSON.stringify(response));
});
test('channel comment sources preserve one-hop parent and reply author branches',async()=>{
 const response=await graphql({schema,source:`{channels(where:{uniqueName:{eq:"forum"}}){
  own:Comments(where:{id:{eq:"a-own"}}){up:ParentComment{who:CommentAuthor{__typename ... on ModerationProfile{createdAt}}}}
  root:Comments(where:{id:{eq:"root"}}){replies:ChildComments(where:{id:{eq:"a-own"}}){who:CommentAuthor{... on User{Email{address}}}}}
 }}`,contextValue:context('alice')});
 assert.equal(response.errors,undefined,JSON.stringify(response.errors));
 assert.deepEqual(JSON.parse(JSON.stringify(response.data)),{channels:[{own:[{up:{who:{__typename:'ModerationProfile',createdAt:'2026-01-01T00:00:00.000Z'}}}],root:[{replies:[{who:{Email:{address:'alice@nested.test'}}}]}]}]});
});
test('channel comment sources preserve filtered pages, nulls, empty results and skipped fields',async()=>{
 const response=await graphql({schema,source:`query($hide:Boolean!=true){channels(where:{uniqueName:{eq:"forum"}}){
  page:Comments(sort:[{id:ASC}],offset:1,limit:1){id CommentAuthor{... on User{username Email @skip(if:$hide){address}}}}
  empty:Comments(where:{id:{eq:"missing"}}){CommentAuthor{__typename}}
  root:Comments(where:{id:{eq:"root"}}){ParentComment{CommentAuthor{__typename}}}
  Comments @skip(if:$hide){CommentAuthor{... on User{Email{address}}}}
 }}`,contextValue:context(null)});
 assert.equal(response.errors,undefined,JSON.stringify(response.errors));
 assert.deepEqual(JSON.parse(JSON.stringify(response.data)),{channels:[{page:[{id:'b-other',CommentAuthor:{username:'bob'}}],empty:[],root:[{ParentComment:null}]}]});
});
test('channel comment source keeps age-gated rows filtered',async()=>{
 await driver.executeQuery("MATCH(c:Comment{id:'b-other'}) SET c.ageGateRestricted=true");
 try{
  const response=await graphql({schema,source:'{channels(where:{uniqueName:{eq:"forum"}}){Comments(where:{id:{in:["a-own","b-other"]}},sort:[{id:ASC}]){id CommentAuthor{__typename}}}}',contextValue:context(null)});
  assert.equal(response.errors,undefined,JSON.stringify(response.errors));
  assert.deepEqual(JSON.parse(JSON.stringify(response.data)),{channels:[{Comments:[{id:'a-own',CommentAuthor:{__typename:'User'}}]}]});
 }finally{await driver.executeQuery("MATCH(c:Comment{id:'b-other'}) SET c.ageGateRestricted=false");}
});
test('channel comment selected scalar failure stays local to the selected child',async()=>{
 await driver.executeQuery("MATCH(u:User{username:'alice'}) SET u.bio=['bad']");
 try{
  const response=await graphql({schema,source:'{channels(where:{uniqueName:{eq:"forum"}}){Comments(where:{id:{eq:"a-own"}}){CommentAuthor{... on User{bio Email{address}}}}}}',contextValue:context('alice')});
  assert.deepEqual(response.errors?.map(error=>error.path),[['channels',0,'Comments',0,'CommentAuthor','bio']],JSON.stringify(response));
  assert.deepEqual(JSON.parse(JSON.stringify(response.data)),{channels:[{Comments:[{CommentAuthor:{bio:null,Email:{address:'alice@nested.test'}}}]}]});
 }finally{await driver.executeQuery("MATCH(u:User{username:'alice'}) SET u.bio='alias'");}
});
test('channel comment author dependency preserves the generated default list cap',async()=>{
 await driver.executeQuery("MATCH(ch:Channel{uniqueName:'forum'}),(u:User{username:'alice'}) UNWIND range(1,30) AS n CREATE(c:Comment{id:'extra-'+toString(n),isRootComment:true,createdAt:datetime()}) CREATE(ch)-[:HAS_COMMENT]->(c),(u)-[:AUTHORED_COMMENT]->(c)");
 try{
  const response=await graphql({schema,source:'{channels(where:{uniqueName:{eq:"forum"}}){all:Comments{CommentAuthor{__typename}} two:Comments(limit:2,sort:[{id:ASC}]){id CommentAuthor{__typename}}}}',contextValue:context(null)});
  assert.equal(response.errors,undefined,JSON.stringify(response.errors));
  const data=JSON.parse(JSON.stringify(response.data));
  assert.equal(data.channels[0].all.length,25);
  assert.deepEqual(data.channels[0].two,[{id:'a-own',CommentAuthor:{__typename:'User'}},{id:'b-other',CommentAuthor:{__typename:'User'}}]);
 }finally{await driver.executeQuery("MATCH(c:Comment) WHERE c.id STARTS WITH 'extra-' DETACH DELETE c");}
});
for(const connection of [false,true])test(`channel deeper reply ${connection?'connection':'list'} preserves aliases and moderator anonymity`,async()=>{
 const body='posts:Comments(where:{id:{eq:"a-own"}}){up:ParentComment{replies:ChildComments(where:{id:{eq:"c-mod"}}){who:CommentAuthor{__typename ... on ModerationProfile{createdAt hidden:User{username}}}}}}';
 const source=connection?`{page:channelsConnection(where:{uniqueName:{eq:"forum"}}){links:edges{entry:node{${body}}}}}`:`{page:channels(where:{uniqueName:{eq:"forum"}}){${body}}}`;
 const response=await graphql({schema,source,contextValue:context('alice')});
 const item={posts:[{up:{replies:[{who:{__typename:'ModerationProfile',createdAt:'2026-01-01T00:00:00.000Z',hidden:null}}]}}]};
 assert.deepEqual(JSON.parse(JSON.stringify(response.data)),connection?{page:{links:[{entry:item}]}}:{page:[item]});
 assert.deepEqual(response.errors?.map(error=>error.path),[connection?['page','links',0,'entry','posts',0,'up','replies',0,'who','hidden']:['page',0,'posts',0,'up','replies',0,'who','hidden']],JSON.stringify(response));
});
