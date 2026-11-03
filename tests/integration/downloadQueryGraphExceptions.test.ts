import assert from 'node:assert/strict';
import {after,before,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import {graphql,type GraphQLSchema} from 'graphql';
import type {Driver} from 'neo4j-driver';
import typeDefs from '../../typeDefs.js';
import getResolvers from '../helpers/getTestResolvers.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver,schema:GraphQLSchema;
before(async()=>{driver=await startNeo4j();schema=await new Neo4jGraphQL({driver,typeDefs,resolvers:getResolvers(driver).resolvers,features:{filters:{String:{MATCHES:true}}}}).getSchema();registerGeneratedSchema(driver,schema);},{timeout:240000});
after(async()=>stopNeo4j());beforeEach(async()=>{
 await resetDatabase(driver);
 // Canonical relationships used by discussion creation: author->discussion;
 // DiscussionChannel->Discussion, and DiscussionChannel->Channel.
 await driver.executeQuery(`CREATE(u:User{username:'alice'})-[:POSTED_DISCUSSION]->(d:Discussion{id:'discussion',title:'Upload',createdAt:datetime(),deleted:false,hasSensitiveContent:false})-[:HAS_DOWNLOADABLE_FILE]->(f:DownloadableFile{id:'file',fileName:'file.zip',kind:'ZIP',createdAt:datetime(),uploadedByUsername:'alice',scanStatus:'SUSPICIOUS'}) CREATE(dc:DiscussionChannel{id:'post',channelUniqueName:'forum',archived:false})-[:POSTED_IN_CHANNEL]->(d) CREATE(dc)-[:POSTED_IN_CHANNEL]->(:Channel{uniqueName:'forum'})`);
});
const execute=(source:string)=>graphql({schema,source,contextValue:{driver,user:{username:'alice',email:null,email_verified:true,data:null},req:{headers:{}},mayAccessSensitiveContent:false}});
function data(result:Awaited<ReturnType<typeof execute>>){assert.equal(result.errors,undefined,JSON.stringify(result.errors));return JSON.parse(JSON.stringify(result.data));}
test('canonical discussion-channel edge supplies the uploaded group channel name',async()=>{
 const canonical=await driver.executeQuery("MATCH(dc:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(:Discussion{id:'discussion'}) RETURN dc.channelUniqueName AS name");assert.equal(canonical.records[0].get('name'),'forum');
 const result=data(await execute('{getUploadedDownloadableFiles(username:"alice"){discussion{id title channelUniqueNames} files{id}}}'));
 assert.deepEqual(result,{getUploadedDownloadableFiles:[{discussion:{id:'discussion',title:'Upload',channelUniqueNames:['forum']},files:[{id:'file'}]}]});
});
test('review queue uses stored uploader metadata when present',async()=>{
 const result=data(await execute('{getDownloadScanReviewQueue{downloadableFileId uploaderUsername channelUniqueName}}'));
 assert.deepEqual(result,{getDownloadScanReviewQueue:[{downloadableFileId:'file',uploaderUsername:'alice',channelUniqueName:'forum'}]});
});
test('canonical discussion author supplies review fallback without uploader metadata',async()=>{
 await driver.executeQuery('MATCH(f:DownloadableFile) REMOVE f.uploadedByUsername');
 const canonical=await driver.executeQuery("MATCH(u:User)-[:POSTED_DISCUSSION]->(:Discussion{id:'discussion'}) RETURN u.username AS username");assert.equal(canonical.records[0].get('username'),'alice');
 const result=data(await execute('{getDownloadScanReviewQueue{downloadableFileId uploaderUsername channelUniqueName}}'));
 assert.deepEqual(result,{getDownloadScanReviewQueue:[{downloadableFileId:'file',uploaderUsername:'alice',channelUniqueName:'forum'}]});
});
