import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {initializeOgmFromExistingSchema} from '../../services/initializeOgmFromExistingSchema.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createPipelineWatchdogRepository} from '../../services/persistence/pipelineWatchdogRepository.js';
import {createStartPluginPipelineResolver} from '../../customResolvers/mutations/startPluginPipeline.js';
import {createPipelineStartRepository} from '../../services/persistence/pipelineStartRepository.js';
import {pipelineStartRepositoryStub} from '../fixtures/pipelineStartRepositoryStub.js';
import type {GraphQLContext} from '../../types/context.js';
import {createDownloadExecutionRepository} from '../../services/persistence/downloadExecutionRepository.js';
import {downloadExecutionRepositoryStub} from '../fixtures/downloadExecutionRepositoryStub.js';
import type {PluginRunCreateInput,PluginRunUpdateInput,DownloadableFileUpdateInput} from '../../ogm_types.js';
import {pipelineWatchdogRepositoryStub} from '../fixtures/pipelineWatchdogRepositoryStub.js';
import {pipelineAttemptRepositoryStub} from '../fixtures/pipelineAttemptRepositoryStub.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {resetDatabase,startNeo4j,stopNeo4j} from './neo4jHarness.js';
let driver:Driver;let ogm:ReturnType<typeof getCustomResolvers>['ogm'];const engine=createSubscriptionEngine();let events:any[]=[];
for(const kind of ['create','update','create_relationship','delete_relationship','delete'])engine.events.on(kind,event=>events.push(event));
async function schema(failure?:'file'|'job'){const app=getCustomResolvers(driver);const overrides:Record<string,Record<string,()=>never>>=failure==='file'?{DownloadableFile:{storageUrl:()=>{throw Error('file projection failed');}}}:failure==='job'?{PluginRun:{message:()=>{throw Error('job projection failed');}}}:{};const neo=new Neo4jGraphQL({driver,typeDefs,resolvers:{...app.resolvers,...overrides},features:{filters:{String:{MATCHES:true}},subscriptions:engine}});const executable=await neo.getSchema();ogm=app.ogm;initializeOgmFromExistingSchema(ogm,neo,executable);registerGeneratedSchema(driver,executable);}
before(async()=>{driver=await startNeo4j();await schema();},{timeout:240000});beforeEach(async()=>{await resetDatabase(driver);events=[];});after(async()=>{await engine.close();await stopNeo4j();});


const models=()=>({Channel:ogm.model('Channel'),Discussion:ogm.model('Discussion'),DownloadableFile:ogm.model('DownloadableFile'),Plugin:ogm.model('Plugin'),PluginVersion:ogm.model('PluginVersion'),PluginPipelineRun:ogm.model('PluginPipelineRun'),PluginRun:ogm.model('PluginRun'),ServerConfig:ogm.model('ServerConfig'),ServerSecret:ogm.model('ServerSecret')});
const old=()=>pipelineStartRepositoryStub(models());
// Nested relationship projections and multi-row reads have no guaranteed cross-run ordering, so deep-sort before snapshotting.
const sortDeep=(value:unknown):unknown=>Array.isArray(value)?value.map(sortDeep).sort((a,b)=>(JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0)):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,sortDeep(v)])):value;
async function seed(){await driver.executeQuery(`CREATE(f:DownloadableFile{id:'file',uploadedByUsername:'owner',uploadedAt:datetime('2020-01-01T00:00:00Z'),createdAt:datetime('2020-01-01T00:00:00Z')}),(s:ServerConfig{serverName:'fixture',pluginPipelines:$pipeline}),(p:Plugin{id:'plugin',name:'plugin'}),(v:PluginVersion{id:'version',version:'1.0.0',repoUrl:'fixture-only',entryPath:'index.js',manifest:$manifest}),(p)-[:HAS_VERSION]->(v),(s)-[:INSTALLED{enabled:true}]->(v),(:Channel{uniqueName:'channel',pluginPipelines:$pipeline})`,{pipeline:JSON.stringify([{event:'downloadableFile.created',steps:[{pluginId:'plugin'}]}]),manifest:JSON.stringify({events:['downloadableFile.created']})});}
test('start snapshots preserve selections, literal values, missing rows and unbounded configuration reads',async(t)=>{
 await seed();await driver.executeQuery("UNWIND range(1,29) AS n CREATE(:ServerConfig{serverName:toString(n)})");const repo=createPipelineStartRepository(driver);
 for(const id of ['file','missing','quote"\\id'])t.assert.snapshot(sortDeep(await repo.findFileTarget(id)));
 for(const name of ['channel','absent',undefined])t.assert.snapshot(sortDeep(await repo.findChannelPlan(name)));
 t.assert.snapshot(sortDeep(await repo.findServerPlan()));assert.equal((await repo.findServerPlan()).length,30);assert.equal(events.length,0);
});
test('discussion target preserves existing singular-field validation failure',async()=>{const repo=createPipelineStartRepository(driver);await assert.rejects(repo.findDiscussionTarget('discussion'),/Cannot query field "DownloadableFile"/);assert.equal(events.length,0);});
test('active attempts retain full predicate, unbounded result and started-attempt projection',async(t)=>{
 await driver.executeQuery(`UNWIND range(1,29) AS n CREATE(:PluginPipelineRun{id:toString(n),pipelineId:toString(n),targetId:'file',targetType:'DownloadableFile',eventType:'downloadableFile.created',scope:'SERVER',status:'RUNNING',trigger:'OWNER_START',attemptNumber:n,configurationSnapshot:'{}',createdAt:datetime('2020-01-01T00:00:00Z'),updatedAt:datetime('2020-01-01T00:00:00Z')})`);
 const repo=createPipelineStartRepository(driver);const where={targetId:'file',targetType:'DownloadableFile',eventType:'downloadableFile.created',scope:'SERVER'};
 t.assert.snapshot(sortDeep(await repo.findActiveAttempts(where)));assert.equal((await repo.findActiveAttempts(where)).length,29);
 for(const id of ['1','missing'])t.assert.snapshot(sortDeep(await repo.findStartedAttempt(id)));
 await assert.rejects(repo.findActiveAttempts({attemptNumber:'not-int'} as never),/Int/);assert.equal(events.length,0);
});
test('actual start resolver retains authentication, ownership, runner identity and missing-attempt error',async()=>{
 {
  await resetDatabase(driver);events=[];await seed();const input={...models(),startRepository:createPipelineStartRepository(driver)};const context=(username?:string)=>({driver,user:username?{username}:undefined}) as GraphQLContext;const args={targetId:'file',targetType:'DownloadableFile',eventType:'downloadableFile.created'};
  let calls=0;let execution:any;const trigger:NonNullable<Parameters<typeof createStartPluginPipelineResolver>[2]>=async(triggerArgs,options)=>{calls++;assert.equal(triggerArgs.driver,driver);assert.equal(triggerArgs.downloadableFileId,'file');execution=options?.execution;return [];};
  const resolver=createStartPluginPipelineResolver(input,async()=>false,trigger,async()=>{throw Error('unexpected channel runner');});
  await assert.rejects(resolver(null,args,context()),/Authentication required/);await assert.rejects(resolver(null,args,context('outsider')),/authorized/);assert.equal(calls,0);
  await assert.rejects(resolver(null,args,context('owner')),/runner did not create an attempt/);assert.equal(calls,1);assert.equal(execution.trigger,'OWNER_START');assert.equal(execution.initiatedByUsername,'owner');assert.equal(events.length,0);
 }
});
test('actual start refetches the committed runner attempt and rejects an existing active attempt',async()=>{
 {
  await resetDatabase(driver);events=[];await seed();const input={...models(),startRepository:createPipelineStartRepository(driver)};
  const trigger:NonNullable<Parameters<typeof createStartPluginPipelineResolver>[2]>=async(_args,options)=>{const execution=options!.execution!;await driver.executeQuery(`CREATE(:PluginPipelineRun{id:'new-attempt',pipelineId:$pipelineId,targetId:'file',targetType:'DownloadableFile',targetVersion:'2020-01-01T00:00:00.000Z',eventType:'downloadableFile.created',scope:'SERVER',status:'RUNNING',trigger:$trigger,attemptNumber:1,configurationSnapshot:'{}',createdAt:datetime('2020-01-01T00:00:00Z'),updatedAt:datetime('2020-01-01T00:00:00Z')})`,{pipelineId:execution.pipelineId,trigger:execution.trigger});return [];};
  const resolver=createStartPluginPipelineResolver(input,async()=>false,trigger);const args={targetId:'file',targetType:'DownloadableFile',eventType:'downloadableFile.created'};const context={driver,user:{username:'owner'}} as GraphQLContext;
  const result=await resolver(null,args,context);assert.equal(result.targetId,'file');assert.equal(result.status,'RUNNING');assert.equal(result.trigger,'OWNER_START');assert.equal(result.attemptNumber,1);await assert.rejects(resolver(null,args,context),/already has an active attempt/);
 }
});
