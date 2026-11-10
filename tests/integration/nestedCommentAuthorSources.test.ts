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
import {registerGeneratedSchema,executeGeneratedOperation} from '../../services/persistence/generatedSchemaOperations.js';
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
    CREATE(a)-[:MODERATION_PROFILE]->(m),(m)-[:AUTHORED_COMMENT]->(root),(m)-[:AUTHORED_COMMENT]->(mod),
    (a)-[:AUTHORED_COMMENT]->(own),(b)-[:AUTHORED_COMMENT]->(other),
    (own)-[:IS_REPLY_TO]->(root),(other)-[:IS_REPLY_TO]->(root),(mod)-[:IS_REPLY_TO]->(root),
    (:Email{address:'alice@nested.test'})-[:HAS_EMAIL]->(a),(:Email{address:'bob@nested.test'})-[:HAS_EMAIL]->(b)`);
},{timeout:240000});
after(async()=>stopNeo4j());
const context=(viewer:string|null)=>({driver,req:{headers:{}},user:viewer?{username:viewer,email:null,email_verified:true,data:null}:null});
test('parent comment preserves moderator type without selecting its name',async()=>{
  const response=await graphql({schema,source:'{comments(where:{id:{eq:"a-own"}}){ParentComment{CommentAuthor{__typename ... on ModerationProfile{createdAt}}}}}',contextValue:context('alice')});
  assert.equal(response.errors,undefined,JSON.stringify(response.errors));
  assert.deepEqual(JSON.parse(JSON.stringify(response.data)),{comments:[{ParentComment:{CommentAuthor:{__typename:'ModerationProfile',createdAt:'2026-01-01T00:00:00.000Z'}}}]});
});
test('child comment supplies identity for an owner-only selected field',async()=>{
  const response=await graphql({schema,source:'{comments(where:{id:{eq:"root"}}){ChildComments(where:{id:{eq:"a-own"}}){CommentAuthor{... on User{Email{address}}}}}}',contextValue:context('alice')});
  assert.equal(response.errors,undefined,JSON.stringify(response.errors));
  assert.deepEqual(JSON.parse(JSON.stringify(response.data)),{comments:[{ChildComments:[{CommentAuthor:{Email:{address:'alice@nested.test'}}}]}]});
});

for(const connection of [false,true])for(const viewer of ['alice','bob',null])test(`reply author aliases preserve ${connection?'connection':'list'} permissions for ${viewer??'anonymous'}`,async()=>{
  const body='children:ChildComments(sort:[{id:ASC}]){id who:CommentAuthor{...Actor}}';
  const source=connection?`query($show:Boolean!=true){page:commentsConnection(where:{id:{eq:"root"}}){links:edges{entry:node{${body}}}}}`:`query($show:Boolean!=true){page:comments(where:{id:{eq:"root"}}){${body}}}`;
  const response=await graphql({schema,source:source+` fragment Actor on CommentAuthor{kind:__typename ... on User{displayName:bio contact:Email @include(if:$show){address}} ... on ModerationProfile{username:displayName hidden:User{username}}}`,contextValue:context(viewer)});
  const children=[
    {id:'a-own',who:{kind:'User',displayName:'alias',contact:viewer==='alice'?{address:'alice@nested.test'}:null}},
    {id:'b-other',who:{kind:'User',displayName:'alias',contact:viewer==='bob'?{address:'bob@nested.test'}:null}},
    {id:'c-mod',who:{kind:'ModerationProfile',username:'Moderator',hidden:null}},
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(response.data)),connection?{page:{links:[{entry:{children}}]}}:{page:[{children}]});
  const prefix=connection?['page','links',0,'entry','children']:['page',0,'children'];
  const paths=[...(viewer==='alice'?[]:[[...prefix,0,'who','contact']]),...(viewer==='bob'?[]:[[...prefix,1,'who','contact']]),[...prefix,2,'who','hidden']];
  assert.deepEqual(response.errors?.map(error=>JSON.stringify(error.path)).sort(),paths.map(path=>JSON.stringify(path)).sort(),JSON.stringify(response));
});
for(const connection of [false,true])test(`parent author aliases preserve moderator anonymity in ${connection?'connections':'lists'}`,async()=>{
  const body='up:ParentComment{who:CommentAuthor{__typename ... on ModerationProfile{username:displayName forbidden:User{username}}}}';
  const source=connection?`{page:commentsConnection(where:{id:{eq:"a-own"}}){links:edges{entry:node{${body}}}}}`:`{page:comments(where:{id:{eq:"a-own"}}){${body}}}`;
  const response=await graphql({schema,source,contextValue:context('alice')});
  const item={up:{who:{__typename:'ModerationProfile',username:'Moderator',forbidden:null}}};
  assert.deepEqual(JSON.parse(JSON.stringify(response.data)),connection?{page:{links:[{entry:item}]}}:{page:[item]});
  assert.deepEqual(response.errors?.map(error=>error.path),[connection?['page','links',0,'entry','up','who','forbidden']:['page',0,'up','who','forbidden']],JSON.stringify(response));
});
test('reply author dependencies preserve filters, pagination, empty lists and directives',async()=>{
  const response=await graphql({schema,source:`query($hide:Boolean!=true){comments(where:{id:{eq:"root"}}){
    page:ChildComments(where:{id:{in:["a-own","b-other"]}},sort:[{id:ASC}],offset:1,limit:1){id CommentAuthor{... on User{username Email @skip(if:$hide){address}}}}
    empty:ChildComments(where:{id:{eq:"missing"}}){CommentAuthor{__typename}}
    ParentComment{CommentAuthor{__typename}}
    ChildComments @skip(if:$hide){CommentAuthor{... on User{Email{address}}}}
  }}`,contextValue:context(null)});
  assert.equal(response.errors,undefined,JSON.stringify(response.errors));
  assert.deepEqual(JSON.parse(JSON.stringify(response.data)),{comments:[{page:[{id:'b-other',CommentAuthor:{username:'bob'}}],empty:[],ParentComment:null}]});
});
test('reply author dependencies preserve nested sensitive-content filtering',async()=>{
  await driver.executeQuery("MATCH(c:Comment) WHERE c.id IN ['root','b-other'] SET c.ageGateRestricted=true");
  try{
    const response=await graphql({schema,source:'{comments(where:{id:{eq:"a-own"}}){ParentComment{CommentAuthor{__typename}}}}',contextValue:context('alice')});
    assert.equal(response.errors,undefined,JSON.stringify(response.errors));
    assert.deepEqual(JSON.parse(JSON.stringify(response.data)),{comments:[{ParentComment:null}]});
    await driver.executeQuery("MATCH(c:Comment{id:'root'}) SET c.ageGateRestricted=false");
    const children=await graphql({schema,source:'{comments(where:{id:{eq:"root"}}){ChildComments(sort:[{id:ASC}]){id CommentAuthor{__typename}}}}',contextValue:context(null)});
    assert.equal(children.errors,undefined,JSON.stringify(children.errors));
    assert.deepEqual(JSON.parse(JSON.stringify(children.data)),{comments:[{ChildComments:[{id:'a-own',CommentAuthor:{__typename:'User'}},{id:'c-mod',CommentAuthor:{__typename:'ModerationProfile'}}]}]});
  }finally{await driver.executeQuery("MATCH(c:Comment) SET c.ageGateRestricted=false");}
});
for(const connection of [false,true])test(`internal reply author ${connection?'connections':'lists'} use generated type metadata`,async()=>{
  const body='up:ParentComment{who:CommentAuthor{kind:__typename ... on ModerationProfile{createdAt}}}';
  const source=connection?`{page:commentsConnection(where:{id:{eq:"a-own"}}){links:edges{entry:node{${body}}}}}`:`{page:comments(where:{id:{eq:"a-own"}}){${body}}}`;
  const result=await executeGeneratedOperation(driver,source,{});
  const item={up:{who:{kind:'ModerationProfile',createdAt:'2026-01-01T00:00:00.000Z'}}};
  assert.deepEqual(JSON.parse(JSON.stringify(result)),connection?{page:{links:[{entry:item}]}}:{page:[item]});
  const children=await executeGeneratedOperation(driver,'{comments(where:{id:{eq:"root"}}){ChildComments(where:{id:{eq:"c-mod"}}){CommentAuthor{__typename}}}}',{});
  assert.deepEqual(JSON.parse(JSON.stringify(children)),{comments:[{ChildComments:[{CommentAuthor:{__typename:'ModerationProfile'}}]}]});
});

test('nested selected scalar errors remain local while owner children complete',async()=>{
  await driver.executeQuery("MATCH(u:User{username:'alice'}) SET u.bio=[1,2]");
  try{
    const response=await graphql({schema,source:'{comments(where:{id:{eq:"root"}}){ChildComments(where:{id:{eq:"a-own"}}){CommentAuthor{... on User{bad:bio Email{address}}}}}}',contextValue:context('alice')});
    assert.deepEqual(response.errors?.map(error=>error.path),[['comments',0,'ChildComments',0,'CommentAuthor','bad']],JSON.stringify(response));
    assert.deepEqual(JSON.parse(JSON.stringify(response.data)),{comments:[{ChildComments:[{CommentAuthor:{bad:null,Email:{address:'alice@nested.test'}}}]}]});
  }finally{await driver.executeQuery("MATCH(u:User{username:'alice'}) SET u.bio='alias'");}
});
test('nested author dependencies retain the generated default child limit',async()=>{
  await driver.executeQuery("MATCH(root:Comment{id:'root'}),(u:User{username:'alice'}) UNWIND range(1,30) AS i CREATE(c:Comment{id:'cap-'+toString(i),isRootComment:false,createdAt:datetime()}) CREATE(c)-[:IS_REPLY_TO]->(root),(u)-[:AUTHORED_COMMENT]->(c)");
  try{
    const response=await graphql({schema,source:'{comments(where:{id:{eq:"root"}}){ChildComments{CommentAuthor{__typename}} two:ChildComments(limit:2){CommentAuthor{__typename}}}}',contextValue:context(null)});
    assert.equal(response.errors,undefined,JSON.stringify(response.errors));
    const data=JSON.parse(JSON.stringify(response.data));
    assert.equal(data.comments[0].ChildComments.length,25);
    assert.equal(data.comments[0].two.length,2);
  }finally{await driver.executeQuery("MATCH(c:Comment) WHERE c.id STARTS WITH 'cap-' DETACH DELETE c");}
});
