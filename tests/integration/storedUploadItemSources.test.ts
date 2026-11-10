import assert from 'node:assert/strict';
import {after,before,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import {graphql,type GraphQLSchema} from 'graphql';
import {applyMiddleware} from 'graphql-middleware';
import type {Driver} from 'neo4j-driver';
import typeDefs from '../../typeDefs.js';
import getResolvers from '../helpers/getTestResolvers.js';
import permissions from '../../permissions.js';
import sourceIdentity from '../../middleware/userChildIdentityMiddleware.js';
import remove from '../../customResolvers/mutations/permanentlyDeleteStoredUpload.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver,schema:GraphQLSchema,deleted:string[]=[];
const previousServerName=process.env.SERVER_CONFIG_NAME;
const deletion=()=>async(input:{storageObjectName?:string|null})=>{deleted.push(input.storageObjectName??'');return {status:'deleted' as const};};
before(async()=>{
 process.env.SERVER_CONFIG_NAME='stored-source-fixture';driver=await startNeo4j();const app=getResolvers(driver).resolvers;
 const raw=await new Neo4jGraphQL({driver,typeDefs,resolvers:{...app,Mutation:{...app.Mutation,
 permanentlyDeleteImage:remove({driver,mediaType:'Image',deleteObject:deletion()}),
 permanentlyDeleteDownloadableFile:remove({driver,mediaType:'DownloadableFile',deleteObject:deletion()}),
 }}}).getSchema();registerGeneratedSchema(driver,raw);schema=applyMiddleware(raw,sourceIdentity,permissions);
},{timeout:240000});
after(async()=>{await stopNeo4j();if(previousServerName===undefined)delete process.env.SERVER_CONFIG_NAME;else process.env.SERVER_CONFIG_NAME=previousServerName;});
beforeEach(async()=>{
 await resetDatabase(driver);deleted=[];
 await driver.executeQuery(`CREATE(u:User {username:'owner'}),(:User {username:'outsider'}),(:ServerConfig {serverName:'stored-source-fixture'})-[:HAS_DEFAULT_MOD_ROLE]->(:ModServerRole {name:'default',canPermanentlyRemoveImage:false}),
 (d:Discussion {id:'d',title:'Discussion',createdAt:datetime('2026-01-01T00:00:00Z')}),
 (f:DownloadableFile {id:'f',fileName:'file.zip',kind:'ZIP',priceModel:'FREE',uploadedByUsername:'owner',createdAt:datetime('2026-01-01T00:00:00Z'),storageBucket:'fixture',storageObjectName:'file',storageUrl:'https://invalid.test/file',url:'https://invalid.test/file'}),
 (i:Image {id:'i',url:'https://invalid.test/image',uploadedByUsername:'owner',storageBucket:'fixture',storageObjectName:'image',storageUrl:'https://invalid.test/image'})
 CREATE(u)-[:POSTED_DISCUSSION]->(d),(d)-[:HAS_DOWNLOADABLE_FILE]->(f),(u)-[:UPLOADED_IMAGE]->(i)`);
});
const context=(username:string|undefined='owner')=>({driver,mayAccessSensitiveContent:false,user:username?{username,email:null,email_verified:true,data:{}}:undefined});
const plain=(value:unknown)=>JSON.parse(JSON.stringify(value));
const operation=(kind:'Image'|'DownloadableFile',fields:string)=>`mutation{result:permanentlyDelete${kind}(${kind==='Image'?'imageId:"i"':'downloadableFileId:"f"'}){${fields}}}`;
test('uploaded discussion and native file fields retain alias meaning',async()=>{
 const result=await graphql({schema,source:'{getUploadedDownloadableFiles(username:"owner"){discussion{id:title} files{id:fileName}}}',contextValue:context()});
 assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 assert.deepEqual(plain(result.data),{getUploadedDownloadableFiles:[{discussion:{id:'Discussion'},files:[{id:'file.zip'}]}]});
});
for(const kind of ['Image','DownloadableFile'] as const)test(`${kind} deletion aliases retain field meaning after the storage and database writes`,async()=>{
 const result=await graphql({schema,source:operation(kind,'id:storageObjectName permanentlyRemoved'),contextValue:context()});
 assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 assert.deepEqual(plain(result.data),{result:{id:kind==='Image'?'image':'file',permanentlyRemoved:true}});
 assert.deepEqual(deleted,[kind==='Image'?'image':'file']);
});
for(const kind of ['Image','DownloadableFile'] as const)test(`${kind} actual removal query emits exactly its declared columns`,async()=>{
 const selections=await import('../../customResolvers/contracts/storedUploadSources.js');
 const row=await remove({driver,mediaType:kind,deleteObject:deletion()})(null,kind==='Image'?{imageId:'i'}:{downloadableFileId:'f'},context());
 assert.deepEqual(Object.keys(row).filter(key=>key!=='storageDeletion').sort(),Object.keys(kind==='Image'?selections.removedImageColumns:selections.removedFileColumns).sort());
 assert.equal(row.permanentlyRemoved,true);assert.equal(row.permanentlyRemovedByModName,null);
});
test('actual uploaded query emits every discussion key and explicit file override',async()=>{
 const [{default:read},{uploadedDiscussionSelection}]=await Promise.all([
  import('../../customResolvers/queries/getUploadedDownloadableFiles.js'),import('../../customResolvers/contracts/storedUploadSources.js'),
 ]);
 const rows=await read({driver})(null,{username:'owner'},context());
 assert.equal(rows.length,1);assert.deepEqual(Object.keys(rows[0].discussion).sort(),Object.keys(uploadedDiscussionSelection).sort());
 assert.equal(rows[0].files.length,1);
 assert.equal(typeof rows[0].files[0].createdAt,'string');assert.equal(rows[0].files[0].uploadedAt,null);assert.equal(rows[0].files[0].permanentlyRemovedAt,null);
 for(const key of ['createdAt','uploadedAt','permanentlyRemovedAt','uploadedByUsername'])assert.ok(Object.prototype.hasOwnProperty.call(rows[0].files[0],key),key);
});
test('uploaded group aliases, fragments and skipped malformed leaves remain selection-aware',async()=>{
 await driver.executeQuery("MATCH(f:DownloadableFile) SET f.fileName=['invalid']");
 const source='query($show:Boolean!){getUploadedDownloadableFiles(username:"owner"){discussion:files{...FileFields}}} fragment FileFields on DownloadableFile{id label:fileName @include(if:$show)}';
 const skipped=await graphql({schema,source,variableValues:{show:false},contextValue:context()});assert.equal(skipped.errors,undefined);
 assert.deepEqual(plain(skipped.data),{getUploadedDownloadableFiles:[{discussion:[{id:'f'}]}]});
 const selected=await graphql({schema,source,variableValues:{show:true},contextValue:context()});
 assert.deepEqual(selected.errors?.[0].path,['getUploadedDownloadableFiles',0,'discussion',0,'label']);
});
for(const kind of ['Image','DownloadableFile'] as const)test(`${kind} deletion preserves denial before storage for anonymous and non-owners`,async()=>{
 for(const actor of ['', 'outsider']){
  const result=await graphql({schema,source:operation(kind,'id'),contextValue:context(actor)});assert.ok(result.errors?.length);
 }
 assert.deepEqual(deleted,[]);
 const rows=await driver.executeQuery(`MATCH(n:${kind}) RETURN n.permanentlyRemoved AS removed`);assert.equal(rows.records[0].get('removed'),null);
});
test('uploaded inventory denies anonymous and non-owner callers',async()=>{
 for(const actor of ['', 'outsider']){
  const result=await graphql({schema,source:'{getUploadedDownloadableFiles(username:"owner"){files{id}}}',contextValue:context(actor)});
  assert.ok(result.errors?.length);assert.equal(result.data,null);
 }
});
