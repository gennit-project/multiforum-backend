import assert from 'node:assert/strict';
import {after,before,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import {graphql,type GraphQLSchema} from 'graphql';
import {applyMiddleware} from 'graphql-middleware';
import type {Driver} from 'neo4j-driver';
import typeDefs from '../../typeDefs.js';
import getResolvers from '../helpers/getTestResolvers.js';
import permissions from '../../permissions.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createCampaignControlRepository,type CampaignTransitionTarget,type CampaignTransitionResult} from '../../services/persistence/campaignControlRepository.js';
import {pausePluginPipelineCampaign,resumePluginPipelineCampaign} from '../../customResolvers/mutations/pluginPipelineCampaigns.js';
import {campaignSelection,campaignPreviewSelection,campaignFailureSelection} from '../../customResolvers/contracts/pluginCampaigns.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver,schema:GraphQLSchema,secured:GraphQLSchema;
let missingTransitionResult=false;
let conflictingTransitionResult=false;
before(async()=>{
 driver=await startNeo4j();const app=getResolvers(driver).resolvers;
 const base=createCampaignControlRepository(driver);
 // Deterministic resolver-result seams; physical race coverage lives in campaignStatusConcurrency.test.ts.
 const controlRepository={...base,transitionStatus:async(id:string,status:CampaignTransitionTarget):Promise<CampaignTransitionResult>=>{
  if(missingTransitionResult){await driver.executeQuery('MATCH(c:PluginPipelineCampaign{id:$id}) DELETE c',{id});return {kind:'missing'};}
  if(conflictingTransitionResult){await driver.executeQuery("MATCH(c:PluginPipelineCampaign{id:$id}) SET c.status='COMPLETED', c.finishedAt=datetime('2026-01-02T00:00:00Z')",{id});return {kind:'conflict',status:'COMPLETED'};}
  return base.transitionStatus(id,status);
 }};
 schema=await new Neo4jGraphQL({driver,typeDefs,resolvers:{...app,Mutation:{...app.Mutation,pausePluginPipelineCampaign:pausePluginPipelineCampaign({driver,controlRepository}),resumePluginPipelineCampaign:resumePluginPipelineCampaign({driver,controlRepository})}},features:{filters:{String:{MATCHES:true}}}}).getSchema();
 registerGeneratedSchema(driver,schema);secured=applyMiddleware(schema,permissions);
},{timeout:240000});
after(async()=>stopNeo4j());beforeEach(async()=>{await resetDatabase(driver);missingTransitionResult=false;conflictingTransitionResult=false;});
const fields=Object.keys(campaignSelection).join(' '),previewFields=Object.keys(campaignPreviewSelection).join(' '),failureFields=Object.keys(campaignFailureSelection).join(' ');
const user={username:'actor',email:null,email_verified:true,data:null};
const execute=(source:string,secure=false,authenticated=true)=>graphql({schema:secure?secured:schema,source,contextValue:{driver,req:{headers:{}},user:authenticated?user:undefined}});
function data(result:Awaited<ReturnType<typeof execute>>){assert.equal(result.errors,undefined,JSON.stringify(result.errors));return JSON.parse(JSON.stringify(result.data));}
async function policy(){await driver.executeQuery("CREATE(:ServerConfig{serverName:'fixture',pluginPipelines:$policy})",{policy:JSON.stringify([{policyId:'policy',event:'downloadableFile.created',effectiveAt:'2026-01-01T00:00:00Z',applicability:'ALL_FILES_GRADUAL',steps:[{pluginId:'scanner'}]}])});}
async function seed(status='RUNNING'){await driver.executeQuery(`CREATE(:PluginPipelineCampaign{id:'campaign',policyId:'policy',eventType:'downloadableFile.created',scope:'SERVER',applicability:'ALL_FILES_GRADUAL',enforcementBehavior:'fixture',status:$status,concurrency:2,rateLimitPerMinute:5,affectedFileCount:0,accessibleFileCount:0,unavailableFileCount:0,estimatedProviderRuns:0,completedCount:0,runningCount:0,failedCount:0,timedOutCount:0,createdByUsername:'actor',createdAt:datetime('2026-01-01T00:00:00Z'),updatedAt:datetime('2026-01-01T00:00:00Z')})`,{status});}
test('campaign history serializes full selected fields, empty results and nullable times',async()=>{
 const source=`{getPluginPipelineCampaigns{${fields}}}`;assert.deepEqual(data(await execute(source)),{getPluginPipelineCampaigns:[]});await seed();const row=data(await execute(source)).getPluginPipelineCampaigns[0];assert.equal(row.status,'RUNNING');assert.equal(row.runningCount,0);assert.equal(row.channelId,null);assert.equal(row.finishedAt,null);assert.equal(row.pausedAt,null);assert.equal(row.startedAt,null);assert.equal(row.createdAt,'2026-01-01T00:00:00.000Z');assert.equal(Object.keys(row).length,Object.keys(campaignSelection).length);
});
test('preview and create serialize counts and authenticated attribution with anonymous URL redaction preserved',async()=>{
 await policy();await driver.executeQuery("CREATE(:DownloadableFile{id:'file',url:'https://fixture.invalid/file',createdAt:datetime('2025-01-01T00:00:00Z'),permanentlyRemoved:false})");
 const preview=data(await execute(`{previewPluginPipelineCampaign(policyId:"policy"){${previewFields}}}`)).previewPluginPipelineCampaign;assert.equal(preview.affectedFileCount,1);assert.equal(preview.accessibleFileCount,0);assert.equal(preview.unavailableFileCount,1);assert.equal(preview.estimatedProviderRuns,0);
 const created=data(await execute(`mutation{createPluginPipelineCampaign(policyId:"policy",concurrency:2,rateLimitPerMinute:5){${fields}}}`)).createPluginPipelineCampaign;assert.equal(created.createdByUsername,'actor');assert.equal(created.status,'RUNNING');assert.equal(created.affectedFileCount,1);assert.equal(created.accessibleFileCount,0);assert.ok(Number.isFinite(Date.parse(created.startedAt)));
 assert.match((await execute('mutation{createPluginPipelineCampaign(policyId:"policy",concurrency:2,rateLimitPerMinute:5){id}}')).errors?.[0].message??'',/active campaign/);
});
test('creation preserves auth, limit and policy failures before writes',async()=>{
 const source='mutation{createPluginPipelineCampaign(policyId:"missing",concurrency:1,rateLimitPerMinute:5){id}}';assert.match((await execute(source,false,false)).errors?.[0].message??'',/Authentication required/);assert.match((await execute(source.replace('concurrency:1','concurrency:0'))).errors?.[0].message??'',/concurrency/);assert.match((await execute(source)).errors?.[0].message??'',/not eligible/);assert.deepEqual(data(await execute('{getPluginPipelineCampaigns{id}}')),{getPluginPipelineCampaigns:[]});
});
test('pause and resume serialize all fields and preserve repeat/missing transition errors',async()=>{
 await seed();const paused=data(await execute(`mutation{pausePluginPipelineCampaign(campaignId:"campaign"){${fields}}}`)).pausePluginPipelineCampaign;assert.equal(paused.status,'PAUSED');assert.ok(Number.isFinite(Date.parse(paused.pausedAt)));
 assert.match((await execute('mutation{pausePluginPipelineCampaign(campaignId:"campaign"){id}}')).errors?.[0].message??'',/cannot make that transition/);
 const resumed=data(await execute(`mutation{resumePluginPipelineCampaign(campaignId:"campaign"){${fields}}}`)).resumePluginPipelineCampaign;assert.equal(resumed.status,'RUNNING');assert.equal(resumed.pausedAt,null);
 assert.match((await execute('mutation{resumePluginPipelineCampaign(campaignId:"missing"){id}}')).errors?.[0].message??'',/Campaign not found/);
});
for(const [field,status] of [['pausePluginPipelineCampaign','RUNNING'],['resumePluginPipelineCampaign','PAUSED']]){
 test(`${field}: missing transition result exposes NOT_FOUND without retry`,async()=>{await seed(status);missingTransitionResult=true;const result=await execute(`mutation{${field}(campaignId:"campaign"){id}}`);assert.equal(result.data,null);assert.equal(result.errors?.[0].extensions.code,'NOT_FOUND');assert.deepEqual(result.errors?.[0].path,[field]);assert.deepEqual(data(await execute('{getPluginPipelineCampaigns{id}}')),{getPluginPipelineCampaigns:[]});});
}
test('generated projection failure after transition retains committed write',async()=>{
 await seed();await driver.executeQuery('MATCH(c:PluginPipelineCampaign) REMOVE c.enforcementBehavior');const result=await execute('mutation{pausePluginPipelineCampaign(campaignId:"campaign"){id}}');assert.equal(result.data,null);assert.ok(result.errors?.some(e=>e.message.includes('enforcementBehavior')));assert.equal((await createCampaignControlRepository(driver).findStatus('campaign'))[0].status,'PAUSED');
});
test('campaign failure responses preserve selected destination, enums and orphan/archive filtering',async()=>{
 const source=`{getPluginPipelineCampaignFailures(campaignId:"campaign"){${failureFields}}}`;assert.deepEqual(data(await execute(source)),{getPluginPipelineCampaignFailures:[]});
 await driver.executeQuery(`CREATE(f:DownloadableFile{id:'file'}),(d:Discussion{id:'discussion'}),(dc:DiscussionChannel{channelUniqueName:'forum',archived:false}),(archive:DiscussionChannel{channelUniqueName:'old',archived:true}) CREATE(d)-[:HAS_DOWNLOADABLE_FILE]->(f),(dc)-[:POSTED_IN_CHANNEL]->(d),(archive)-[:POSTED_IN_CHANNEL]->(d) WITH 1 AS unused UNWIND ['FAILED','TIMED_OUT','CANCELLED','SUCCEEDED'] AS status CREATE(:PluginPipelineRun{id:status,pipelineId:status,campaignId:'campaign',targetId:'file',status:status,attemptNumber:1}) CREATE(:PluginPipelineRun{id:'orphan-'+status,pipelineId:'orphan',campaignId:'campaign',targetId:'missing',status:status,attemptNumber:2})`);
 const rows=data(await execute(source)).getPluginPipelineCampaignFailures;assert.deepEqual(rows.map((r:{status:string})=>r.status).sort(),['CANCELLED','FAILED','TIMED_OUT']);assert.ok(rows.every((r:{channelId:string;discussionId:string;attemptNumber:number})=>r.channelId==='forum'&&r.discussionId==='discussion'&&r.attemptNumber===1));
 await driver.executeQuery('MATCH(dc:DiscussionChannel) SET dc.archived=true');assert.deepEqual(data(await execute(source)),{getPluginPipelineCampaignFailures:[]});
});
test('malformed selected enum read retains schema error even with outer id-only selection',async()=>{await seed('INVALID');const result=await execute('{getPluginPipelineCampaigns{id}}');assert.equal(result.data,null);assert.ok(result.errors?.some(e=>e.message.includes('PluginPipelineCampaignStatus')));});
test('permission middleware denies all six anonymous campaign operations',async()=>{
 for(const source of ['{getPluginPipelineCampaigns{id}}','{getPluginPipelineCampaignFailures(campaignId:"campaign"){pipelineId}}','{previewPluginPipelineCampaign(policyId:"policy"){policyId}}','mutation{createPluginPipelineCampaign(policyId:"policy",concurrency:1,rateLimitPerMinute:5){id}}','mutation{pausePluginPipelineCampaign(campaignId:"campaign"){id}}','mutation{resumePluginPipelineCampaign(campaignId:"campaign"){id}}'])assert.ok((await execute(source,true,false)).errors,source);
});

// Missing/conflicting repository results must propagate without a second update.
for(const [field,initial] of [
 ['pausePluginPipelineCampaign','RUNNING'],
 ['resumePluginPipelineCampaign','PAUSED'],
] as const){
 test(`${field}: conflict preserves the competing completed state`,async()=>{
  await seed(initial);conflictingTransitionResult=true;
  const result=await execute(`mutation{${field}(campaignId:"campaign"){id status finishedAt}}`);
  assert.equal(result.errors?.[0].extensions.code,'CONFLICT');assert.equal(result.data,null);
  conflictingTransitionResult=false;
  assert.equal((await createCampaignControlRepository(driver).findStatus('campaign'))[0].status,'COMPLETED');
 });
}
