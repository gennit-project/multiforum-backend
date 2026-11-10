import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import {provisionServerDefaults} from '../../seedData/provisionServerDefaults.js';
import {createServerDefaultsRepository} from '../../services/persistence/serverDefaultsRepository.js';
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
  process.env.E2E_MOCK_AUTH="true";process.env.SERVER_CONFIG_NAME="comment-response-contract";
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
    CREATE(ch:Channel{uniqueName:'forum',createdAt:datetime()}),(:ServerConfig{serverName:'comment-response-contract'})
    CREATE(ch)-[:HAS_COMMENT]->(root),(ch)-[:HAS_COMMENT]->(own),(ch)-[:HAS_COMMENT]->(other),(ch)-[:HAS_COMMENT]->(mod)
    CREATE(a)-[:MODERATION_PROFILE]->(m),(m)-[:AUTHORED_COMMENT]->(root),(m)-[:AUTHORED_COMMENT]->(mod),
    (a)-[:AUTHORED_COMMENT]->(own),(b)-[:AUTHORED_COMMENT]->(other),
    (own)-[:IS_REPLY_TO]->(root),(other)-[:IS_REPLY_TO]->(root),(mod)-[:IS_REPLY_TO]->(root),
    (:Email{address:'alice@nested.test'})-[:HAS_EMAIL]->(a),(:Email{address:'bob@nested.test'})-[:HAS_EMAIL]->(b)`);
  await provisionServerDefaults({repository:createServerDefaultsRepository(driver),serverName:'comment-response-contract'});
},{timeout:240000});
after(async()=>stopNeo4j());
const context=(viewer:string|null)=>({driver,req:{headers:viewer?{authorization:`Bearer ${jwt.sign({username:viewer,email:`${viewer}@test.invalid`,email_verified:true},'test-only')}`}:{},body:{},isMutation:true}});
for(const id of ['a-own','c-mod'])test(`comment update payload preserves author contract for ${id}`,async()=>{
 const response=await graphql({schema,source:`mutation{updateComments(where:{id:{eq:"${id}"}},update:{text:{set:"edited"}}){comments{id CommentAuthor{__typename ... on User{Email{address}} ... on ModerationProfile{createdAt}}}}}`,contextValue:context('alice')});
 assert.equal(response.errors,undefined,JSON.stringify(response.errors));
 const author=id==='a-own'?{__typename:'User',Email:{address:'alice@nested.test'}}:{__typename:'ModerationProfile',createdAt:'2026-01-01T00:00:00.000Z'};
 assert.deepEqual(JSON.parse(JSON.stringify(response.data)),{updateComments:{comments:[{id,CommentAuthor:author}]}});
});
for(const id of ['a-own','c-mod'])for(const viewer of ['bob',null])test(`comment update denies ${viewer??'anonymous'} before writing ${id}`,async()=>{
 const before=(await driver.executeQuery('MATCH(c:Comment{id:$id}) RETURN c.text AS text',{id})).records[0].get('text');
 const response=await graphql({schema,source:`mutation{updateComments(where:{id:{eq:"${id}"}},update:{text:{set:"forbidden"}}){comments{CommentAuthor{__typename}}}}`,contextValue:context(viewer)});
 assert.ok(response.errors?.length,JSON.stringify(response));
 assert.equal((await driver.executeQuery('MATCH(c:Comment{id:$id}) RETURN c.text AS text',{id})).records[0].get('text'),before);
});
test('comment mutation payload fragments retain aliased author identity and moderator anonymity',async()=>{
 const response=await graphql({schema,source:`mutation($show:Boolean!=true){save:updateComments(where:{id:{eq:"a-own"}},update:{text:{set:"fragment edit"}}){...Payload}}
 fragment Payload on UpdateCommentsMutationResponse{rows:comments{id who:CommentAuthor{... on User{username:bio mail:Email @include(if:$show){address}}} up:ParentComment{who:CommentAuthor{__typename ... on ModerationProfile{createdAt hidden:User{username}}}}}}`,contextValue:context('alice')});
 assert.equal((await driver.executeQuery("MATCH(c:Comment{id:'a-own'}) RETURN c.text AS text")).records[0].get('text'),'fragment edit');
 assert.deepEqual(response.errors?.map(error=>error.path),[['save','rows',0,'up','who','hidden']],JSON.stringify(response));
 assert.deepEqual(JSON.parse(JSON.stringify(response.data)),{save:{rows:[{id:'a-own',who:{username:'alias',mail:{address:'alice@nested.test'}},up:{who:{__typename:'ModerationProfile',createdAt:'2026-01-01T00:00:00.000Z',hidden:null}}}]}});
});
test('comment mutation retains post-write local scalar errors and permits other selected children',async()=>{
 await driver.executeQuery("MATCH(u:User{username:'alice'}) SET u.bio=['bad']");
 try{
  const response=await graphql({schema,source:'mutation{updateComments(where:{id:{eq:"a-own"}},update:{text:{set:"committed edit"}}){comments{CommentAuthor{... on User{bio Email{address}}}}}}',contextValue:context('alice')});
  assert.deepEqual(response.errors?.map(error=>error.path),[['updateComments','comments',0,'CommentAuthor','bio']],JSON.stringify(response));
  assert.deepEqual(JSON.parse(JSON.stringify(response.data)),{updateComments:{comments:[{CommentAuthor:{bio:null,Email:{address:'alice@nested.test'}}}]}});
  assert.equal((await driver.executeQuery("MATCH(c:Comment{id:'a-own'}) RETURN c.text AS text")).records[0].get('text'),'committed edit');
 }finally{await driver.executeQuery("MATCH(u:User{username:'alice'}) SET u.bio='alias'");}
});
test('comment mutation skipped protected children preserve successful writes and directive defaults',async()=>{
 const response=await graphql({schema,source:'mutation($hide:Boolean!=true){save:updateComments(where:{id:{eq:"a-own"}},update:{text:{set:"skipped child"}}){comments{id CommentAuthor{... on User{bio Email @skip(if:$hide){address}}}}}}',contextValue:context('alice')});
 assert.equal(response.errors,undefined,JSON.stringify(response.errors));
 assert.deepEqual(JSON.parse(JSON.stringify(response.data)),{save:{comments:[{id:'a-own',CommentAuthor:{bio:'alias'}}]}});
});
test('comment mutation missing targets retain authorization errors without writes',async()=>{
 const response=await graphql({schema,source:'mutation{updateComments(where:{id:{eq:"missing"}},update:{text:{set:"new"}}){comments{CommentAuthor{__typename}}}}',contextValue:context('alice')});
 assert.ok(response.errors?.length,JSON.stringify(response));
 assert.equal((await driver.executeQuery("MATCH(c:Comment{id:'missing'}) RETURN c")).records.length,0);
});
