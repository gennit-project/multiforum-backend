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
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver,schema:GraphQLSchema;
before(async()=>{driver=await startNeo4j();const raw=await new Neo4jGraphQL({driver,typeDefs,resolvers:getResolvers(driver).resolvers}).getSchema();registerGeneratedSchema(driver,raw);schema=applyMiddleware(raw,middleware,permissions);},{timeout:240000});
after(async()=>stopNeo4j());
beforeEach(async()=>{await resetDatabase(driver);await driver.executeQuery(`CREATE(u:User{username:'alice',displayName:'Alice',createdAt:datetime()}),
 (co:Collection{id:'collection',name:'Collection',visibility:'PUBLIC',collectionType:'DISCUSSIONS',itemOrder:[],createdAt:datetime(),updatedAt:datetime()}),
 (d:Discussion{id:'d',title:'Title',hasDownload:true,createdAt:datetime()}),(co)-[:CREATED_BY]->(u),(co)-[:CONTAINS_DISCUSSION]->(d),(co)-[:CONTAINS_DOWNLOAD]->(d),(u)-[:POSTED_DISCUSSION]->(d),
 (a:Album{id:'album',imageOrder:[]}),(d)-[:HAS_ALBUM]->(a),(i:Image{id:'image',url:'url',caption:'Caption'}),(a)-[:HAS_IMAGE]->(i)`);});
const run=(fields:string,username:string|null='alice')=>graphql({schema,source:`{publicCollectionsContaining(itemId:"d",itemType:DISCUSSION){${fields}}}`,contextValue:{driver,req:{headers:{}},mayAccessSensitiveContent:false,user:username?{username,email:null,email_verified:true,data:null}:null}});
const plain=(value:unknown)=>JSON.parse(JSON.stringify(value));
test('fixed public collection and album images preserve nested canonical aliases',async()=>{
 const result=await run('id:name name:id CreatedBy{username:displayName} Downloads{Album{Images{url:caption caption:url}}}');
 assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 assert.deepEqual(plain(result.data),{publicCollectionsContaining:[{id:'Collection',name:'collection',CreatedBy:{username:'Alice'},Downloads:[{Album:{Images:[{url:'Caption',caption:'url'}]}}]}]});
});
test('fixed collection author identity remains raw across internal GraphQL completion',async()=>{
 await driver.executeQuery("MATCH(u:User) SET u.username=17.5");
 const result=await run('CreatedBy{hidden:Email{address}}','17.5');
 assert.ok(result.errors?.some(error=>error.path?.includes('hidden')));
});
test('fixed profile collections preserve selected aliases',async()=>{
 const result=await graphql({schema,source:'{users(where:{username:{eq:"alice"}}){Collections{id:name name:id}}}',contextValue:{driver,req:{headers:{}},mayAccessSensitiveContent:false,user:{username:'alice',email:null,email_verified:true,data:null}}});
 assert.equal(result.errors,undefined);
 assert.deepEqual(plain(result.data),{users:[{Collections:[{id:'Collection',name:'collection'}]}]});
});
for(const field of ['CreatedBy','Downloads{Author'] as const){
 const selection=(fields:string)=>field==='CreatedBy'?`CreatedBy{${fields}}`:`Downloads{Author{${fields}}}`;
 test(`fixed ${field} source preserves legitimate owner access and outsider denial`,async()=>{
  const owner=await run(selection('hidden:Email{address}'));assert.equal(owner.errors,undefined,JSON.stringify(owner.errors));
  for(const username of [null,'outsider']){
   const denied=await run(selection('hidden:Email{address}'),username);
   assert.ok(denied.errors?.some(error=>error.path?.includes('hidden')));
  }
 });
 test(`fixed ${field} source retains identity through outer aliases and fragments`,async()=>{
  await driver.executeQuery('MATCH(u:User) SET u.username=17.5');
  const result=await run(selection('username:displayName displayName:username hidden:Email{address}'),'17.5');
  assert.ok(result.errors?.some(error=>error.path?.includes('hidden')));
  assert.ok(!JSON.stringify(result.data).includes('_accountIdentity'));
 });
}
test('fixed public collection source retains skipped private selections and nullable creators',async()=>{
 const result=await graphql({schema,source:'query($hide:Boolean!){publicCollectionsContaining(itemId:"d",itemType:DISCUSSION){...Fields}} fragment Fields on Collection{name CreatedBy{hidden:Email @skip(if:$hide){address}}}',variableValues:{hide:true},contextValue:{driver,req:{headers:{}},mayAccessSensitiveContent:false}});
 assert.equal(result.errors,undefined);
 await driver.executeQuery('MATCH(co:Collection)-[r:CREATED_BY]->() DELETE r');
 const missing=await run('CreatedBy{username}');assert.equal(missing.errors,undefined);assert.deepEqual(plain(missing.data),{publicCollectionsContaining:[{CreatedBy:null}]});
});
test('fixed collection sources retain eager validation of their owned internal document',async()=>{
 await driver.executeQuery("MATCH(i:Image) SET i.url=['invalid']");
 // The pre-existing fixed internal read selects this URL even if the outer
 // request does not. Preserve that error boundary rather than inventing laziness.
 const result=await run('name');assert.match(result.errors?.[0].message??'',/Failed to fetch public collections/);
});
test('parallel fixed collection reads preserve independent response aliases',async()=>{
 const result=await graphql({schema,source:'{first:publicCollectionsContaining(itemId:"d",itemType:DISCUSSION){id:name CreatedBy{hidden:Email{address}}} second:publicCollectionsContaining(itemId:"d",itemType:DISCUSSION){name:id Downloads{Album{Images{url:caption}}}}}',contextValue:{driver,req:{headers:{}},mayAccessSensitiveContent:false,user:{username:'alice',email:null,email_verified:true,data:null}}});
 assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 assert.deepEqual(plain(result.data),{first:[{id:'Collection',CreatedBy:{hidden:null}}],second:[{name:'collection',Downloads:[{Album:{Images:[{url:'Caption'}]}}]}]});
});
