import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import {graphql,type GraphQLSchema} from 'graphql';
import type {Driver} from 'neo4j-driver';
import typeDefs from '../../typeDefs.js';
import getResolvers from '../helpers/getTestResolvers.js';
import shareCollection from '../../customResolvers/mutations/shareCollectionAsDiscussion.js';
import {createDiscussionCreationRepository} from '../../services/persistence/discussionCreationRepository.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver,schema:GraphQLSchema;
let deleteBeforeRefetch=false;
let committedIdentity:string|undefined;
before(async()=>{
 driver=await startNeo4j();const app=getResolvers(driver);const repository=createDiscussionCreationRepository(driver);
 app.resolvers.Mutation.shareCollectionAsDiscussion=shareCollection({driver,discussionCreationRepository:{...repository,findCreatedDiscussion:async (id,tx)=>{
  if(deleteBeforeRefetch){
   // Owned edges and response read share the transaction; an absent projection rolls back.
   assert.ok(tx);
   const persisted=await tx.run("MATCH(:User {username:'alice'})-[:POSTED_DISCUSSION]->(d:Discussion {id:$id})-[:SHARES_COLLECTION]->(:Collection {id:'collection'}) RETURN d.id AS id",{id});
   assert.equal(persisted.records.length,1);committedIdentity=persisted.records[0].get('id');
   await tx.run('MATCH(d:Discussion {id:$id}) DETACH DELETE d',{id});
  }
  return repository.findCreatedDiscussion(id,tx);
 }}});
 schema=await new Neo4jGraphQL({driver,typeDefs,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}}}}).getSchema();registerGeneratedSchema(driver,schema);
},{timeout:240000});
after(async()=>stopNeo4j());
beforeEach(async()=>{
 deleteBeforeRefetch=false;committedIdentity=undefined;await resetDatabase(driver);
 await driver.executeQuery("CREATE(a:User {username:'alice',createdAt:datetime()}),(c:Channel {uniqueName:'forum',createdAt:datetime()}),(a)-[:ADMIN_OF_CHANNEL]->(c),(:Collection {id:'collection',name:'Collection',visibility:'PUBLIC',collectionType:'DISCUSSIONS',createdAt:datetime(),updatedAt:datetime(),itemOrder:[]})-[:CREATED_BY]->(a)");
});
const exec=()=>graphql({schema,source:'mutation{shareCollectionAsDiscussion(collectionId:"collection",serverId:"forum",title:"Shared"){id title}}',contextValue:{driver,req:{headers:{}},user:{username:'alice',email:null,email_verified:true,data:null},mayAccessSensitiveContent:false}});
test('share wrapper returns real created discussion identity and retains collection edge',async()=>{
 const result=await exec();assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 const rows=(await driver.executeQuery("MATCH(d:Discussion)-[:SHARES_COLLECTION]->(:Collection {id:'collection'}) RETURN d.id AS id")).records;
 assert.equal(rows.length,1);assert.deepEqual(JSON.parse(JSON.stringify(result.data)),{shareCollectionAsDiscussion:{id:rows[0].get('id'),title:'Shared'}});
});
test('missing transactional response rejects sharing and rolls back the item',async()=>{
 deleteBeforeRefetch=true;const result=await exec();
 assert.equal(typeof committedIdentity,'string');assert.equal(result.data,null);
 assert.deepEqual(result.errors?.[0].path,['shareCollectionAsDiscussion']);
 assert.match(result.errors?.[0].message??'',/Created discussion is unavailable for the response/);
 assert.equal((await driver.executeQuery('MATCH(d:Discussion) RETURN d')).records.length,0);
 assert.equal((await driver.executeQuery("MATCH(c:Collection {id:'collection'}) RETURN c")).records.length,1);
});

test('share wrapper does not fabricate a result when its creation dependency returns an empty array',async()=>{
 const field=schema.getMutationType()!.getFields().shareCollectionAsDiscussion;
 const original=field.resolve;
 // @ts-expect-error deliberately violate the nonempty dependency contract to retain outer completion evidence
 field.resolve=shareCollection({driver,createDiscussions:async()=>[]});
 try{
  const result=await exec();
  assert.equal(result.data,null);
  assert.deepEqual(result.errors?.[0].path,['shareCollectionAsDiscussion']);
  assert.match(result.errors?.[0].message??'',/Cannot return null for non-nullable field/);
  assert.equal((await driver.executeQuery('MATCH(d:Discussion) RETURN d')).records.length,0);
 }finally{field.resolve=original;}
});

test('repeated sharing returns distinct complete selected snapshots with aliases and fragments',async()=>{
 const source=`mutation { shared: shareCollectionAsDiscussion(collectionId:"collection",serverId:"forum",title:"Shared") { ...Created } }
 fragment Created on Discussion { id title body Author { username } DiscussionChannels { id discussionId channelUniqueName archived Channel {uniqueName} Discussion {id} UpvotedByUsers {username} Flairs {id} } Tags {text} }`;
 const execute=()=>graphql({schema,source,contextValue:{driver,req:{headers:{}},user:{username:'alice',email:null,email_verified:true,data:null},mayAccessSensitiveContent:false}});
 const first=await execute(),second=await execute();
 for(const result of [first,second]){
  assert.equal(result.errors,undefined,JSON.stringify(result.errors));
  const item=JSON.parse(JSON.stringify(result.data)).shared;
  assert.equal(typeof item.id,'string');assert.equal(item.title,'Shared');assert.equal(item.body,'');
  assert.deepEqual(item.Author,{username:'alice'});assert.deepEqual(item.Tags,[]);
  assert.equal(item.DiscussionChannels.length,1);
  const channel=item.DiscussionChannels[0];assert.equal(channel.discussionId,item.id);
  assert.equal(channel.channelUniqueName,'forum');assert.equal(channel.archived,false);
  assert.deepEqual(channel.Channel,{uniqueName:'forum'});assert.deepEqual(channel.Discussion,{id:item.id});
  assert.deepEqual(channel.UpvotedByUsers,[{username:'alice'}]);assert.deepEqual(channel.Flairs,[]);
 }
 assert.notEqual(JSON.parse(JSON.stringify(first.data)).shared.id,JSON.parse(JSON.stringify(second.data)).shared.id);
 assert.equal((await driver.executeQuery("MATCH(:Discussion)-[:SHARES_COLLECTION]->(:Collection {id:'collection'}) RETURN count(*) AS n")).records[0].get('n').toNumber(),2);
});

for(const [name,setup,message] of [
 ['private collection',"MATCH(c:Collection {id:'collection'}) SET c.visibility='PRIVATE'",/Only public collections/],
 ['non-owner',"MATCH(:Collection)-[r:CREATED_BY]->(:User) DELETE r",/do not own/],
 ['missing forum',"MATCH(c:Channel {uniqueName:'forum'}) DETACH DELETE c",/Forum not found/],
] as const){
 test(`share response rejects ${name} without creating a discussion`,async()=>{
  await driver.executeQuery(setup);const result=await exec();
  assert.equal(result.data,null);assert.match(result.errors?.[0].message??'',message);
  assert.deepEqual(result.errors?.[0].path,['shareCollectionAsDiscussion']);
  assert.equal((await driver.executeQuery('MATCH(d:Discussion) RETURN d')).records.length,0);
 });
}

test('empty discussion batches reject before creating any rows',async()=>{
 const result=await graphql({schema,source:'mutation { createDiscussionWithChannelConnections(input:[]) {id} }',contextValue:{driver,req:{headers:{}},user:{username:'alice',email:null,email_verified:true,data:null},mayAccessSensitiveContent:false}});
 assert.match(result.errors?.[0].message??'',/Input cannot be empty/);
 assert.equal((await driver.executeQuery('MATCH(d:Discussion) RETURN d')).records.length,0);
});
