import assert from 'node:assert/strict';
import {after,before,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import {graphql,type GraphQLSchema} from 'graphql';
import typeDefs from '../../typeDefs.js';
import getStoredUploadDeleteResolver from '../../customResolvers/mutations/permanentlyDeleteStoredUpload.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {mockToken,modContext,resetDb,run,startImageModEnv,stopImageModEnv,type ImageModEnv} from './imageModerationHarness.js';

// Exception witnesses: real resolver, executable application schema and disposable
// database; only the external object deletion is replaced with a local seam.
let env:ImageModEnv,schema:GraphQLSchema,deletedObjects:string[]=[];
before(async()=>{
 env=await startImageModEnv();
 schema=await new Neo4jGraphQL({driver:env.driver,typeDefs,resolvers:{...env.resolvers,Mutation:{...env.resolvers.Mutation,permanentlyDeleteDownloadableFile:getStoredUploadDeleteResolver({driver:env.driver,mediaType:'DownloadableFile',deleteObject:async(input)=>{deletedObjects.push(input.storageObjectName??'');return {status:'deleted'};}})}},features:{filters:{String:{MATCHES:true}}}}).getSchema();
 registerGeneratedSchema(env.driver,schema);
},{timeout:240000});
after(async()=>stopImageModEnv());
beforeEach(async()=>{await resetDb();deletedObjects=[];await run("CREATE(:User{username:'alice'}) CREATE(:UploadedFileAudit{id:'audit',storageBucket:'fixture',storageObjectName:'uploads/alice/file.zip',storageUrl:'https://example.invalid/file.zip',originalFilename:'file.zip',contentType:'application/zip',uploadedAt:datetime('2026-01-01T00:00:00Z'),uploadedByUsername:'alice'})");});
const execute=(source:string)=>graphql({schema,source,contextValue:modContext(env,mockToken({username:'alice',email:'alice@example.com'}))});
const create=(selection:string)=>`mutation{createDownloadableFiles(input:[{fileName:"file.zip",kind:ZIP,url:"https://example.invalid/file.zip",storageObjectName:"uploads/alice/file.zip"}]){${selection}}}`;
async function assertCreatedAndClaimed(){const rows=await run("MATCH(f:DownloadableFile),(a:UploadedFileAudit{id:'audit'}) RETURN f.id AS id,a.claimedById AS claimedById,a.claimedByType AS claimedByType");assert.equal(rows.length,1);assert.equal(rows[0].claimedById,rows[0].id);assert.equal(rows[0].claimedByType,'DownloadableFile');}
test('upload selected file response succeeds and claims audit metadata',async()=>{
 const result=await execute(create('downloadableFiles{id fileName kind createdAt priceModel}'));assert.equal(result.errors,undefined,JSON.stringify(result.errors));assert.ok(result.data);await assertCreatedAndClaimed();
});
test('upload missing non-null info fails GraphQL completion after file and audit claim commit',async()=>{
 const result=await execute(create('downloadableFiles{id} info{nodesCreated}'));assert.equal(result.data,null);assert.match(result.errors?.[0].message??'',/Cannot return null for non-nullable field CreateDownloadableFilesMutationResponse.info/);assert.deepEqual(result.errors?.[0].path,['createDownloadableFiles','info']);await assertCreatedAndClaimed();
});
async function seedFile(){await run("CREATE(:DownloadableFile{id:'file',fileName:'file.zip',kind:'ZIP',url:'https://example.invalid/file.zip',storageBucket:'fixture',storageObjectName:'uploads/alice/file.zip',uploadedByUsername:'alice',createdAt:datetime('2026-01-01T00:00:00Z'),priceModel:'FREE'})");}
async function assertDeleted(){assert.deepEqual(deletedObjects,['uploads/alice/file.zip']);const rows=await run("MATCH(f:DownloadableFile{id:'file'}) RETURN f.permanentlyRemoved AS removed,f.permanentlyRemovedByUsername AS actor");assert.deepEqual(rows,[{removed:true,actor:'alice'}]);}
test('permanent deletion selected removal response succeeds after local storage seam and persisted marker',async()=>{
 await seedFile();const result=await execute('mutation{permanentlyDeleteDownloadableFile(downloadableFileId:"file"){id fileName kind permanentlyRemoved permanentlyRemovedAt}}');assert.equal(result.errors,undefined,JSON.stringify(result.errors));assert.ok(result.data);await assertDeleted();
});
for(const field of ['createdAt','priceModel']){
 test(`permanent deletion omits existing non-null ${field} from response after committing deletion`,async()=>{
  await seedFile();const result=await execute(`mutation{permanentlyDeleteDownloadableFile(downloadableFileId:"file"){id ${field}}}`);assert.deepEqual(JSON.parse(JSON.stringify(result.data)),{permanentlyDeleteDownloadableFile:null});assert.match(result.errors?.[0].message??'',new RegExp(`Cannot return null for non-nullable field DownloadableFile.${field}`));assert.deepEqual(result.errors?.[0].path,['permanentlyDeleteDownloadableFile',field]);await assertDeleted();
 });
}
