import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import {graphql,type GraphQLSchema,type GraphQLObjectType} from 'graphql';
import permissions from '../../permissions.js';
import {applyMiddleware} from 'graphql-middleware';
import sourceIdentity from '../../middleware/userChildIdentityMiddleware.js';
import type {Driver} from 'neo4j-driver';
import typeDefs from '../../typeDefs.js';
import getResolvers from '../helpers/getTestResolvers.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createStartPluginPipelineResolver} from '../../customResolvers/mutations/startPluginPipeline.js';
import {createRerunPluginPipelineResolver} from '../../customResolvers/mutations/rerunPluginPipeline.js';
import {createRetryDownloadableFileScanResolver} from '../../customResolvers/mutations/retryDownloadableFileScan.js';
import {createDownloadExecutionRepository} from '../../services/persistence/downloadExecutionRepository.js';
import {startedAttemptSelection,returnedJobSelection} from '../../customResolvers/contracts/pluginExecution.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver,schema:GraphQLSchema,generatedSchema:GraphQLSchema;
let runnerMode:'write'|'missing'|'fail'='write';let calls=0;
const trigger:NonNullable<Parameters<typeof createStartPluginPipelineResolver>[2]>=async(_args,options)=>{
 calls++;if(runnerMode==='fail')throw Error('provider fixture failure');if(runnerMode==='missing')return [];
 const execution=options!.execution!;
 await driver.executeQuery(`CREATE(:PluginPipelineRun{id:'new-attempt',pipelineId:$pipelineId,targetId:'file',targetType:'DownloadableFile',targetVersion:'2020-01-01T00:00:00.000Z',eventType:'downloadableFile.created',scope:'SERVER',status:'RUNNING',trigger:$trigger,retryOfPipelineRunId:$retry,attemptNumber:1,configurationSnapshot:'{}',createdAt:datetime('2020-01-01T00:00:00Z'),updatedAt:datetime('2020-01-01T00:00:00Z')})`,{pipelineId:execution.pipelineId,trigger:execution.trigger,retry:execution.retryOfPipelineRunId??null});return [];
};
before(async()=>{driver=await startNeo4j();const app=getResolvers(driver).resolvers;
 schema=await new Neo4jGraphQL({driver,typeDefs,resolvers:{...app,Mutation:{...app.Mutation,startPluginPipeline:createStartPluginPipelineResolver({},async()=>false,trigger),rerunPluginPipeline:createRerunPluginPipelineResolver({},async()=>false,trigger),retryDownloadableFileScan:createRetryDownloadableFileScanResolver({},async()=>false,async()=>createDownloadExecutionRepository(driver).findReturnedRun('job')) }},features:{filters:{String:{MATCHES:true}}}}).getSchema();registerGeneratedSchema(driver,schema);generatedSchema=schema;schema=applyMiddleware(schema,sourceIdentity);
},{timeout:240000});beforeEach(async()=>{await resetDatabase(driver);runnerMode='write';calls=0;});after(async()=>{await stopNeo4j();});
const execute=(source:string,username:string|undefined='owner')=>graphql({schema,source,contextValue:{driver,user:username?{username}:undefined}});
function data(result:Awaited<ReturnType<typeof execute>>){assert.equal(result.errors,undefined,JSON.stringify(result.errors));return JSON.parse(JSON.stringify(result.data));}
const attemptFields=Object.keys(startedAttemptSelection).join(' '),jobFields=Object.keys(returnedJobSelection).join(' ');
const start=`mutation{startPluginPipeline(targetId:"file",targetType:"DownloadableFile",eventType:"downloadableFile.created"){${attemptFields}}}`;
async function seed(){await driver.executeQuery(`CREATE(f:DownloadableFile{id:'file',uploadedByUsername:'owner',scanStatus:'PENDING',uploadedAt:datetime('2020-01-01T00:00:00Z'),createdAt:datetime('2020-01-01T00:00:00Z')}),(s:ServerConfig{serverName:'fixture',pluginPipelines:$pipeline}),(p:Plugin{id:'plugin',name:'plugin'}),(v:PluginVersion{id:'version',version:'1.0.0',repoUrl:'fixture-only',entryPath:'index.js',manifest:$manifest}),(p)-[:HAS_VERSION]->(v),(s)-[:INSTALLED{enabled:true}]->(v)`,{pipeline:JSON.stringify([{event:'downloadableFile.created',steps:[{pluginId:'plugin'}]}]),manifest:JSON.stringify({events:['downloadableFile.created']})});}
async function failed(targetType='DownloadableFile'){await driver.executeQuery(`CREATE(:PluginPipelineRun{id:'old',pipelineId:'old',targetId:'file',targetType:$targetType,targetVersion:'2020-01-01T00:00:00.000Z',eventType:'downloadableFile.created',scope:'SERVER',status:'FAILED',trigger:'OWNER_START',createdAt:datetime('2020-01-01T00:00:00Z')})`,{targetType});}
test('start serializes exact attempt projection, null timestamps and enums; repeated start is rejected',async()=>{await seed();const row=data(await execute(start)).startPluginPipeline;assert.equal(row.status,'RUNNING');assert.equal(row.trigger,'OWNER_START');assert.equal(row.attemptNumber,1);assert.equal(row.finishedAt,null);assert.equal(row.channelId,null);assert.match((await execute(start)).errors?.[0].message??'',/active attempt/);assert.equal(calls,1);});
test('rerun serializes guarded persisted attempt and retry attribution',async()=>{await seed();await failed();const row=data(await execute(`mutation{rerunPluginPipeline(pipelineRunId:"old"){${attemptFields}}}`)).rerunPluginPipeline;assert.equal(row.retryOfPipelineRunId,'old');assert.equal(row.trigger,'OWNER_RETRY');assert.equal(row.targetId,'file');});
test('start preserves auth, ownership, missing target and provider error ordering',async()=>{await seed();assert.match((await execute(start,'')).errors?.[0].message??'',/Authentication/);assert.match((await execute(start,'outsider')).errors?.[0].message??'',/authorized/);assert.equal(calls,0);runnerMode='fail';assert.match((await execute(start)).errors?.[0].message??'',/provider fixture/);assert.equal(calls,1);await driver.executeQuery('MATCH(f:DownloadableFile) DELETE f');assert.match((await execute(start)).errors?.[0].message??'',/not found/);assert.equal(calls,1);});
test('missing runner attempt preserves explicit error rather than returning absent nonnull value',async()=>{await seed();runnerMode='missing';assert.match((await execute(start)).errors?.[0].message??'',/did not create an attempt/);});
for(const field of ['startPluginPipeline','rerunPluginPipeline'])test(`${field} validates the supported Discussion selection before reporting a missing target`,async()=>{await seed();await failed('Discussion');const source=field==='startPluginPipeline'?'mutation{startPluginPipeline(targetId:"file",targetType:"Discussion",channelId:"forum",eventType:"downloadableFile.created"){pipelineId}}':'mutation{rerunPluginPipeline(pipelineRunId:"old"){pipelineId}}';const result=await execute(source);assert.match(result.errors?.[0].message??'',/not found|channelId|channel/i);assert.deepEqual(result.errors?.[0].path,[field]);assert.equal(calls,0);});
test('retry serializes empty returned job list and retains clean-file rejection',async()=>{await seed();const source=`mutation{retryDownloadableFileScan(downloadableFileId:"file"){${jobFields}}}`;assert.deepEqual(data(await execute(source)).retryDownloadableFileScan,[]);await driver.executeQuery("MATCH(f:DownloadableFile) SET f.scanStatus='CLEAN'");assert.match((await execute(source)).errors?.[0].message??'',/clean downloadable/);});
test('trigger rejects unsupported event/missing file and returns no jobs without installed configuration',async()=>{const source=`mutation{triggerDownloadableFilePluginRuns(downloadableFileId:"file",event:"downloadableFile.created"){${jobFields}}}`;assert.match((await execute(source.replace('downloadableFile.created','invalid'))).errors?.[0].message??'',/Unsupported plugin event/);assert.match((await execute(source)).errors?.[0].message??'',/not found/);await driver.executeQuery("CREATE(:DownloadableFile{id:'file',fileName:'file.zip',url:'https://invalid.test/file',kind:'ZIP',size:1,createdAt:datetime('2020-01-01T00:00:00Z')})");assert.deepEqual(data(await execute(source)).triggerDownloadableFilePluginRuns,[]);});

test('retry serializes persisted nullable job fields and preserves integer coercion and missing required-field errors',async()=>{await seed();await driver.executeQuery("CREATE(:PluginRun{id:'job',pluginId:'plugin',version:'1.0.0',scope:'SERVER',eventType:'downloadableFile.created',status:'SKIPPED',executionOrder:0,createdAt:datetime('2020-01-01T00:00:00Z'),updatedAt:datetime('2020-01-01T00:00:00Z')})");const row=data(await execute(`mutation{retryDownloadableFileScan(downloadableFileId:"file"){${jobFields}}}`)).retryDownloadableFileScan[0];assert.equal(row.status,'SKIPPED');assert.equal(row.executionOrder,0);assert.equal(row.message,null);assert.equal(row.durationMs,null);await driver.executeQuery("MATCH(j:PluginRun) SET j.executionOrder='INVALID'");assert.equal(data(await execute('mutation{retryDownloadableFileScan(downloadableFileId:"file"){id executionOrder}}')).retryDownloadableFileScan[0].executionOrder,0);await driver.executeQuery('MATCH(j:PluginRun) REMOVE j.pluginId');assert.match((await execute('mutation{retryDownloadableFileScan(downloadableFileId:"file"){id}}')).errors?.[0].message??'',/pluginId/);});

for(const action of ['start','rerun'] as const){
 const operation=action==='start'?'startPluginPipeline(targetId:"file",targetType:"DownloadableFile",eventType:"downloadableFile.created")':'rerunPluginPipeline(pipelineRunId:"old")';
 test(`${action}: response retains the stored attempt identity`,async()=>{
  await seed();if(action==='rerun')await failed();
  const response=await execute(`mutation{result:${operation}{id pipelineId}}`);
  assert.equal(calls,1);assert.equal((await driver.executeQuery("MATCH(a:PluginPipelineRun{id:'new-attempt'}) RETURN count(a) AS count")).records[0].get("count").toNumber(),1);
  const result=data(response).result;
  assert.equal(result.id,'new-attempt');assert.equal(typeof result.pipelineId,'string');assert.equal(calls,1);
 });
 test(`${action}: response aliases preserve status and pipeline identity`,async()=>{
  await seed();if(action==='rerun')await failed();
  const result=data(await execute(`mutation{result:${operation}{status:pipelineId pipelineId:status}}`)).result;
  assert.equal(result.pipelineId,'RUNNING');assert.notEqual(result.status,'RUNNING');assert.equal(calls,1);
 });
}
test('retry job aliases preserve fixed returned fields',async()=>{
 await seed();await driver.executeQuery("CREATE(:PluginRun{id:'job',pluginId:'plugin',version:'1.0.0',scope:'SERVER',eventType:'downloadableFile.created',status:'SKIPPED',executionOrder:0,createdAt:datetime('2020-01-01T00:00:00Z'),updatedAt:datetime('2020-01-01T00:00:00Z')})");
 assert.deepEqual(data(await execute('mutation{result:retryDownloadableFileScan(downloadableFileId:"file"){pluginId:id id:pluginId}}')).result,[{pluginId:'job',id:'plugin'}]);
});

test('internal trigger aliases preserve skipped persisted jobs while the public root stays denied',async()=>{
 await seed();await driver.executeQuery("MATCH(f:DownloadableFile) SET f.fileName='fixture.zip',f.kind='ZIP',f.url='https://fixture.invalid/file'");
 await driver.executeQuery('MATCH(s:ServerConfig) SET s.pluginPipelines=$pipeline',{pipeline:JSON.stringify([{event:'downloadableFile.created',steps:[{pluginId:'plugin',condition:'PREVIOUS_FAILED'}]}])});
 const source='mutation{result:triggerDownloadableFilePluginRuns(downloadableFileId:"file",event:"downloadableFile.created"){pluginId:id id:pluginId status}}';
 const denied=await graphql({schema:applyMiddleware(schema,permissions),source,contextValue:{driver,req:{headers:{}},user:{username:'owner',email:null,email_verified:true,data:{}}}});assert.ok(denied.errors?.length);
 assert.equal((await driver.executeQuery('MATCH(j:PluginRun) RETURN count(j) AS count')).records[0].get('count').toNumber(),0);
 // Trusted URL fixture isolates returned-job selection. The failed-previous-step
 // condition skips execution before loading a plugin or accessing any provider.
 const field=(generatedSchema.getType('DownloadableFile') as GraphQLObjectType).getFields().url;const original=field.resolve;
 field.resolve=(parent:{url:string})=>parent.url;
 try{
  const rows=data(await execute(source)).result;assert.equal(rows.length,1);assert.equal(rows[0].id,'plugin');assert.equal(rows[0].status,'SKIPPED');
  const stored=await driver.executeQuery('MATCH(j:PluginRun) RETURN j.id AS id,j.status AS status');assert.equal(stored.records.length,1);assert.equal(rows[0].pluginId,stored.records[0].get('id'));assert.equal(stored.records[0].get('status'),'SKIPPED');
 }finally{field.resolve=original;}
});

test('checked start source preserves Shield, ownership, fragments, skipped fields and repeat guards',async()=>{
 await seed();await driver.executeQuery("CREATE(:User{username:'owner'}),(:User{username:'outsider'})");
 const source='mutation($skip:Boolean!){result:startPluginPipeline(targetId:"file",targetType:"DownloadableFile",eventType:"downloadableFile.created"){identity:id ...State ignored:finishedAt @skip(if:$skip)}} fragment State on PluginPipelineRun{pipelineId:status finishedAt}';
 const secured=applyMiddleware(schema,permissions);
 const run=(username?:string)=>graphql({schema:secured,source,variableValues:{skip:true},contextValue:{driver,req:{headers:{},body:{query:source}},user:username?{username,email:null,email_verified:true,data:{}}:undefined}});
 assert.ok((await run()).errors?.length);assert.equal(calls,0);
 assert.ok((await run('outsider')).errors?.length);assert.equal(calls,0);
 const result=await run('owner');assert.deepEqual(data(result).result,{identity:'new-attempt',pipelineId:'RUNNING',finishedAt:null});assert.equal(calls,1);
 assert.ok((await run('owner')).errors?.length);assert.equal(calls,1);
});
