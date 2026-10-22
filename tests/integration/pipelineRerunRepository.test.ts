import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {initializeOgmFromExistingSchema} from '../../services/initializeOgmFromExistingSchema.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createPipelineWatchdogRepository} from '../../services/persistence/pipelineWatchdogRepository.js';
import {createRerunPluginPipelineResolver} from '../../customResolvers/mutations/rerunPluginPipeline.js';
import {createPipelineRerunRepository} from '../../services/persistence/pipelineRerunRepository.js';
import {pipelineRerunRepositoryStub} from '../fixtures/pipelineRerunRepositoryStub.js';
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
const old=()=>pipelineRerunRepositoryStub(models());
async function seed(){await driver.executeQuery(`CREATE(f:DownloadableFile{id:'file',uploadedByUsername:'owner',uploadedAt:datetime('2020-01-01T00:00:00Z'),createdAt:datetime('2020-01-01T00:00:00Z')}),(s:ServerConfig{serverName:'fixture',pluginPipelines:$pipeline}),(p:Plugin{id:'plugin',name:'plugin'}),(v:PluginVersion{id:'version',version:'1.0.0',repoUrl:'fixture-only',entryPath:'index.js',manifest:$manifest}),(p)-[:HAS_VERSION]->(v),(s)-[:INSTALLED{enabled:true}]->(v),(:Channel{uniqueName:'channel',pluginPipelines:$pipeline})`,{pipeline:JSON.stringify([{event:'downloadableFile.created',steps:[{pluginId:'plugin'}]}]),manifest:JSON.stringify({events:['downloadableFile.created']})});}

const now=Date.parse('2026-01-01T12:00:00Z');
async function attempt(pipelineId='source',status='FAILED',trigger='OWNER_START',createdAt='2026-01-01T10:00:00Z',targetVersion:string|null=null){await driver.executeQuery(`CREATE(:PluginPipelineRun{id:$pipelineId,pipelineId:$pipelineId,targetId:'file',targetType:'DownloadableFile',targetVersion:$targetVersion,eventType:'downloadableFile.created',scope:'SERVER',status:$status,trigger:$trigger,createdAt:datetime($createdAt),updatedAt:datetime($createdAt),attemptNumber:1,configurationSnapshot:'{}'})`,{pipelineId,status,trigger,createdAt,targetVersion});}
test('rerun reads preserve selections, literal IDs, missing results and unbounded related attempts',async()=>{
 await seed();await attempt();const repo=createPipelineRerunRepository(driver);
 for(const id of ['source','missing','quote"\\id'])assert.deepEqual(await repo.findSourceAttempt(id),await old().findSourceAttempt(id));
 for(const id of ['file','missing'])assert.deepEqual(await repo.findFileVersion(id),await old().findFileVersion(id));
 await driver.executeQuery(`UNWIND range(1,29) AS n CREATE(:PluginPipelineRun{pipelineId:toString(n),targetId:'other',targetType:'DownloadableFile',status:'FAILED',trigger:'OWNER_RETRY',createdAt:datetime('2026-01-01T10:00:00Z')})`);
 const where={targetId:'other',targetType:'DownloadableFile'};assert.deepEqual(await repo.findRelatedAttempts(where),await old().findRelatedAttempts(where));assert.equal((await repo.findRelatedAttempts(where)).length,29);assert.equal(events.length,0);
});
test('discussion version query preserves the existing singular-selection error',async()=>{await assert.rejects(createPipelineRerunRepository(driver).findDiscussionVersion('discussion'),/Cannot query field "DownloadableFile"/);});
for(const scenario of ['missing','status','changed','latest','cooldown','limit'] as const)test(`actual rerun preserves ${scenario} rejection without runner calls`,async()=>{
 for(const legacy of [true,false]){
  await resetDatabase(driver);events=[];await seed();let expected:RegExp;
  if(scenario!=='missing')await attempt('source',scenario==='status'?'RUNNING':'FAILED',scenario==='cooldown'?'OWNER_RETRY':'OWNER_START',scenario==='cooldown'?'2026-01-01T11:59:30Z':'2026-01-01T10:00:00Z',scenario==='changed'?'1999-01-01T00:00:00.000Z':null);
  if(scenario==='latest')await attempt('newer','FAILED','OWNER_START','2026-01-01T11:00:00Z');
  if(scenario==='limit'){await driver.executeQuery("MATCH(p:PluginPipelineRun) DELETE p");for(const [id,time] of [['older1','11:10'],['older2','11:20'],['source','11:30']])await attempt(id,'FAILED','OWNER_RETRY',`2026-01-01T${time}:00Z`);}
  expected={missing:/not found/,status:/Only failed/,changed:/file has changed/,latest:/Only the latest/,cooldown:/at least one minute/,limit:/retry limit/}[scenario];
  let calls=0;const runner=async()=>{calls++;return [];};const resolver=createRerunPluginPipelineResolver({...models(),rerunRepository:legacy?old():createPipelineRerunRepository(driver)},async()=>false,runner,runner,()=>now);
  await assert.rejects(resolver(null,{pipelineRunId:'source'},{driver,user:{username:'owner'}} as GraphQLContext),expected);assert.equal(calls,0);assert.equal(events.length,0);
 }
});
test('actual rerun forwards owner retry metadata through start and returns committed attempt',async()=>{
 for(const legacy of [true,false]){
  await resetDatabase(driver);events=[];await seed();await attempt();let captured:any;
  const runner:NonNullable<Parameters<typeof createRerunPluginPipelineResolver>[2]>=async(args,options)=>{assert.equal(args.driver,driver);captured=options?.execution;await driver.executeQuery(`CREATE(:PluginPipelineRun{id:'new',pipelineId:$pipelineId,targetId:'file',targetType:'DownloadableFile',eventType:'downloadableFile.created',scope:'SERVER',status:'RUNNING',trigger:$trigger,retryOfPipelineRunId:$retryOfPipelineRunId,createdAt:datetime('2026-01-01T12:00:00Z'),updatedAt:datetime('2026-01-01T12:00:00Z'),attemptNumber:2,configurationSnapshot:'{}'})`,{pipelineId:captured.pipelineId,trigger:captured.trigger,retryOfPipelineRunId:captured.retryOfPipelineRunId});return [];};
  const resolver=createRerunPluginPipelineResolver({...models(),rerunRepository:legacy?old():createPipelineRerunRepository(driver)},async()=>false,runner,async()=>{throw Error('unexpected channel runner');},()=>now);
  const result=await resolver(null,{pipelineRunId:'source'},{driver,user:{username:'owner'}} as GraphQLContext);assert.equal(result.trigger,'OWNER_RETRY');assert.equal(result.retryOfPipelineRunId,'source');assert.equal(captured.initiatedByUsername,'owner');assert.equal(result.attemptNumber,2);
 }
});
