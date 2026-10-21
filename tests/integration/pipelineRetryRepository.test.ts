import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {initializeOgmFromExistingSchema} from '../../services/initializeOgmFromExistingSchema.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createPipelineWatchdogRepository} from '../../services/persistence/pipelineWatchdogRepository.js';
import {createRetryDownloadableFileScanResolver} from '../../customResolvers/mutations/retryDownloadableFileScan.js';
import {createPipelineRetryRepository} from '../../services/persistence/pipelineRetryRepository.js';
import {pipelineRetryRepositoryStub} from '../fixtures/pipelineRetryRepositoryStub.js';
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
const old=()=>pipelineRetryRepositoryStub(models());

const context=(username?:string)=>({driver,user:username?{username}:undefined}) as GraphQLContext;
async function seed(){await driver.executeQuery(`CREATE(f:DownloadableFile{id:'file',uploadedByUsername:'owner',scanStatus:'FAILED'}),(d:Discussion{id:'discussion'}),(u:User{username:'author'}),(u)-[:POSTED_DISCUSSION]->(d),(d)-[:HAS_DOWNLOADABLE_FILE]->(f),(a:DiscussionChannel{id:'active',channelUniqueName:'active',archived:false}),(a)-[:POSTED_IN_CHANNEL]->(d),(b:DiscussionChannel{id:'archived',channelUniqueName:'archived',archived:true}),(b)-[:POSTED_IN_CHANNEL]->(d)`);}
test('retry reads preserve canonical owner/channel projections, literals and unbounded attempts/jobs',async()=>{
 await seed();const repo=createPipelineRetryRepository(driver);assert.deepEqual(await repo.findScanTarget('file'),await old().findScanTarget('file'));const file=(await repo.findScanTarget('file'))[0] as any;assert.equal(file.Discussion.Author.username,'author');assert.deepEqual(file.Discussion.DiscussionChannels.map((c:any)=>c.channelUniqueName).sort(),['active','archived']);
 for(const id of ['missing','quote"\\id'])assert.deepEqual(await repo.findScanTarget(id),await old().findScanTarget(id));
 await driver.executeQuery(`UNWIND range(1,29) AS n CREATE(:PluginPipelineRun{pipelineId:toString(n),targetId:'file',status:'FAILED',createdAt:datetime('2026-01-01T00:00:00Z')}),(:PluginRun{id:toString(n),pipelineId:'new',pluginId:'plugin',version:'1.0.0',scope:'SERVER',eventType:'fixture',status:'FAILED',createdAt:datetime('2026-01-01T00:00:00Z'),updatedAt:datetime('2026-01-01T00:00:00Z')})`);
 assert.deepEqual(await repo.findFailedAttempts({targetId:'file'}),await old().findFailedAttempts({targetId:'file'}));assert.equal((await repo.findFailedAttempts({targetId:'file'})).length,29);assert.deepEqual(await repo.findRetryJobs('new'),await old().findRetryJobs('new'));assert.equal((await repo.findRetryJobs('new')).length,29);assert.equal(events.length,0);
});
test('actual retry retains missing/clean/unauthorized errors before runner calls',async()=>{
 for(const legacy of [true,false]){await resetDatabase(driver);events=[];await seed();let calls=0;const resolver=createRetryDownloadableFileScanResolver({...models(),retryRepository:legacy?old():createPipelineRetryRepository(driver)},async()=>false,async()=>{calls++;return [];});
 await assert.rejects(resolver(null,{downloadableFileId:'missing'},context('owner')),/not found/);await assert.rejects(resolver(null,{downloadableFileId:'file'},context()),/Not authorized/);await driver.executeQuery("MATCH(f:DownloadableFile) SET f.scanStatus='CLEAN'");await assert.rejects(resolver(null,{downloadableFileId:'file'},context('owner')),/clean downloadable/);assert.equal(calls,0);assert.equal(events.length,0);}
});
for(const username of ['owner','author','moderator'])test(`actual retry direct trigger preserves ${username} permission and configured driver`,async()=>{
 for(const legacy of [true,false]){await resetDatabase(driver);events=[];await seed();const permissions:string[]=[];let args:any;const resolver=createRetryDownloadableFileScanResolver({...models(),retryRepository:legacy?old():createPipelineRetryRepository(driver)},async(input)=>{permissions.push(input.channelName);return input.channelName==='active';},async(input)=>{args=input;return ['fixture'];});
 assert.deepEqual(await resolver(null,{downloadableFileId:'file'},context(username)),['fixture']);assert.equal(args.driver,driver);assert.equal(args.event,'downloadableFile.updated');assert.equal(args.downloadableFileId,'file');assert.deepEqual(permissions,username==='moderator'?['active']:[]);assert.equal(events.length,0);}
});
test('actual retry chooses latest failed server/channel attempt then refetches rerun jobs',async()=>{
 for(const legacy of [true,false]){await resetDatabase(driver);events=[];await seed();await driver.executeQuery(`CREATE(:PluginPipelineRun{pipelineId:'old-server',targetId:'file',targetType:'DownloadableFile',eventType:'downloadableFile.created',status:'FAILED',createdAt:datetime('2026-01-01T00:00:00Z')}),(:PluginPipelineRun{pipelineId:'new-channel',targetId:'discussion',targetType:'Discussion',eventType:'discussionChannel.created',status:'TIMED_OUT',createdAt:datetime('2026-01-02T00:00:00Z')}),(:PluginRun{id:'job',pipelineId:'rerun',pluginId:'plugin',version:'1.0.0',scope:'CHANNEL',eventType:'fixture',status:'SUCCEEDED',createdAt:datetime('2026-01-03T00:00:00Z'),updatedAt:datetime('2026-01-03T00:00:00Z')})`);
 const order:string[]=[];const factory:NonNullable<Parameters<typeof createRetryDownloadableFileScanResolver>[3]>=()=>async(_parent,args,ctx)=>{assert.equal(ctx.driver,driver);order.push(args.pipelineRunId);return {pipelineId:'rerun'} as any;};
 const resolver=createRetryDownloadableFileScanResolver({...models(),retryRepository:legacy?old():createPipelineRetryRepository(driver)},async()=>false,async()=>{throw Error('unexpected direct trigger');},factory);const jobs=await resolver(null,{downloadableFileId:'file'},context('owner')) as any[];assert.deepEqual(order,['new-channel']);assert.equal(jobs.length,1);assert.equal(jobs[0].id,'job');assert.equal(jobs[0].status,'SUCCEEDED');assert.equal(events.length,0);}
});
