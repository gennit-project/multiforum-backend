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
 app.resolvers.Mutation.shareCollectionAsDiscussion=shareCollection({driver,discussionCreationRepository:{...repository,findCreatedDiscussion:async id=>{
  if(deleteBeforeRefetch){
   // Separate driver query witnesses committed ownership/share edges before
   // simulating another transaction deleting the discussion ahead of refetch.
   const persisted=await driver.executeQuery("MATCH(:User {username:'alice'})-[:POSTED_DISCUSSION]->(d:Discussion {id:$id})-[:SHARES_COLLECTION]->(:Collection {id:'collection'}) RETURN d.id AS id",{id});
   assert.equal(persisted.records.length,1);committedIdentity=persisted.records[0].get('id');
   await driver.executeQuery('MATCH(d:Discussion {id:$id}) DETACH DELETE d',{id});
  }
  return repository.findCreatedDiscussion(id);
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
test('post-commit disappearance propagates through share wrapper as non-null root failure',async()=>{
 deleteBeforeRefetch=true;const result=await exec();
 assert.equal(typeof committedIdentity,'string');assert.equal(result.data,null);
 assert.deepEqual(result.errors?.[0].path,['shareCollectionAsDiscussion']);
 assert.match(result.errors?.[0].message??'',/Cannot return null for non-nullable field Mutation.shareCollectionAsDiscussion/);
 assert.equal((await driver.executeQuery('MATCH(d:Discussion) RETURN d')).records.length,0);
 assert.equal((await driver.executeQuery("MATCH(c:Collection {id:'collection'}) RETURN c")).records.length,1);
});
