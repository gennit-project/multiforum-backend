import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import type {Driver} from 'neo4j-driver';
import {Neo4jGraphQL} from '@neo4j/graphql';
import {graphql,type GraphQLSchema} from 'graphql';
import {applyMiddleware} from 'graphql-middleware';
import typeDefs from '../../typeDefs.js';
import permissions from '../../permissions.js';
import getResolvers from '../helpers/getTestResolvers.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {startNeo4j,stopNeo4j} from './neo4jHarness.js';
let driver:Driver;let schema:GraphQLSchema;
before(async()=>{
 driver=await startNeo4j();
 const raw=await new Neo4jGraphQL({driver,typeDefs,resolvers:getResolvers(driver).resolvers}).getSchema();
 registerGeneratedSchema(driver,raw);schema=applyMiddleware(raw,permissions);
 await driver.executeQuery(`
 CREATE (channel:Channel {uniqueName:'forum'})
 WITH channel UNWIND ['alice','bob'] AS username
 CREATE(u:User{username:username,createdAt:datetime()})
 WITH channel,u,username UNWIND [0,1,2] AS i
 CREATE(c:Collection{id:username+'-'+toString(i),name:username+'-'+toString(i),visibility:CASE i WHEN 1 THEN 'PRIVATE' ELSE 'PUBLIC' END,collectionType:'DISCUSSIONS',itemOrder:[],createdAt:datetime('2026-01-0'+toString(i+1)+'T00:00:00Z'),updatedAt:datetime()})-[:CREATED_BY]->(u)
 CREATE(c)-[:CONTAINS_CHANNEL]->(channel)`);
},{timeout:240000});
after(async()=>stopNeo4j());
const context=(viewer:string|null)=>({driver,req:{headers:{}},jwt:viewer?{sub:viewer}:undefined,user:viewer?{username:viewer,email:null,email_verified:true,data:null}:null,mayAccessSensitiveContent:false});
async function read(profile:string,viewer:string|null,where:unknown=null,options:Record<string,unknown>={}){
 const result=await graphql({schema,source:`query Profile($profile:String!,$where:CollectionWhere,$sort:[CollectionSort!],$limit:Int,$offset:Int){users(where:{username:{eq:$profile}}){username items:Collections(where:$where,sort:$sort,limit:$limit,offset:$offset){...CollectionFields}}} fragment CollectionFields on Collection {id visibility}`,variableValues:{profile,where,...options},contextValue:context(viewer)});
 assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 return JSON.parse(JSON.stringify(result.data)).users[0].items.map((row:{id:string})=>row.id);
}
test('owner sees own public and private collections; others and anonymous see only public',async()=>{
 assert.deepEqual(await read('alice','alice'),['alice-2','alice-1','alice-0']);
 for(const viewer of ['bob',null])assert.deepEqual(await read('alice',viewer),['alice-2','alice-0']);
});
test('caller creator filters cannot replace profile scope, including nested alternatives',async()=>{
 const filters=[{CreatedBy:{username:{eq:'bob'}}},{OR:[{CreatedBy:{username:{eq:'bob'}}},{id:{eq:'bob-1'}}]},{NOT:{CreatedBy:{username:{eq:'alice'}}}},{AND:[{CreatedBy:{username:{eq:'bob'}}},{visibility:{eq:'PRIVATE'}}]}];
 for(const viewer of ['alice','bob',null])for(const filter of filters)assert.deepEqual(await read('alice',viewer,filter),[]);
});
test('private and mixed visibility filters only narrow the authorized set',async()=>{
 assert.deepEqual(await read('alice','alice',{visibility:{eq:'PRIVATE'}}),['alice-1']);
 for(const viewer of ['bob',null]){
  assert.deepEqual(await read('alice',viewer,{visibility:{eq:'PRIVATE'}}),[]);
  assert.deepEqual(await read('alice',viewer,{OR:[{visibility:{eq:'PRIVATE'}},{id:{eq:'alice-0'}}]}),['alice-0']);
 }
});
test('legitimate relationship and creator filters compose with profile access',async()=>{
 const where={CreatedBy:{username:{eq:'alice'}},Channels:{some:{uniqueName:{eq:'forum'}}},NOT:{id:{eq:'alice-2'}}};
 assert.deepEqual(await read('alice','alice',where),['alice-1','alice-0']);
 assert.deepEqual(await read('alice','bob',where),['alice-0']);
 assert.deepEqual(await read('alice',null,{Channels:{some:{uniqueName:{eq:'missing'}}}}),[]);
});
test('schema pagination and sorting apply after authorization filtering',async()=>{
 assert.deepEqual(await read('alice','alice',null,{sort:[{name:'ASC'}],limit:1,offset:1}),['alice-1']);
 assert.deepEqual(await read('alice','bob',null,{sort:[{name:'ASC'}],limit:1,offset:1}),['alice-2']);
 // Preserve generated Neo4j zero-limit behavior (unbounded), while filtering access.
 assert.deepEqual(await read('alice',null,null,{limit:0}),['alice-2','alice-0']);
});

test('generated root lists and connection counts exclude private collections of other owners',async()=>{
 for(const viewer of ['alice',null]){
  const result=await graphql({schema,source:`{collections(sort:[{name:ASC}]){id} collectionsConnection{totalCount edges{node{id}}}}`,contextValue:context(viewer)});
  assert.equal(result.errors,undefined,JSON.stringify(result.errors));
  const data=JSON.parse(JSON.stringify(result.data));
  const expected=viewer?['alice-0','alice-1','alice-2','bob-0','bob-2']:['alice-0','alice-2','bob-0','bob-2'];
  assert.deepEqual(data.collections.map((row:{id:string})=>row.id),expected);
  assert.equal(data.collectionsConnection.totalCount,expected.length);
  assert.deepEqual(data.collectionsConnection.edges.map((edge:{node:{id:string}})=>edge.node.id).sort(),expected);
 }
});
test('generated reverse relationships obey the same read boundary',async()=>{
 for(const viewer of ['alice','bob',null]){
  const result=await graphql({schema,source:`{channels(where:{uniqueName:{eq:"forum"}}){InCollections{ id } InCollectionsConnection{totalCount}}}`,contextValue:context(viewer)});
  assert.equal(result.errors,undefined,JSON.stringify(result.errors));
  const data=JSON.parse(JSON.stringify(result.data));
  const allowed=['alice-0','alice-2','bob-0','bob-2',...(viewer?[viewer+'-1']:[])].sort();
  assert.deepEqual(data.channels[0].InCollections.map((row:{id:string})=>row.id).sort(),allowed);
  assert.equal(data.channels[0].InCollectionsConnection.totalCount,allowed.length);
 }
});

test('profile connection retains its existing Shield denial',async()=>{
 for(const viewer of ['alice','bob',null]){
  const result=await graphql({schema,source:'{users(where:{username:{eq:"alice"}}){CollectionsConnection{totalCount}}}',contextValue:context(viewer)});
  assert.equal(result.data,null);assert.equal(result.errors?.length,1);
  assert.deepEqual(result.errors?.[0].path,['users',0,'CollectionsConnection']);
  assert.match(result.errors?.[0].message??'',/Not Authorised/);
 }
});
test('root filters cannot request private rows outside viewer ownership',async()=>{
 for(const viewer of ['alice',null]){
  const result=await graphql({schema,source:'{collections(where:{visibility:{eq:PRIVATE}}){id} collectionsConnection(where:{visibility:{eq:PRIVATE}}){aggregate{count{nodes}}}}',contextValue:context(viewer)});
  assert.equal(result.errors,undefined,JSON.stringify(result.errors));
  const data=JSON.parse(JSON.stringify(result.data));
  assert.deepEqual(data.collections.map((row:{id:string})=>row.id),viewer?['alice-1']:[]);
  assert.equal(data.collectionsConnection.aggregate.count.nodes,viewer?1:0);
 }
});
