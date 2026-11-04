import assert from 'node:assert/strict';
import test from 'node:test';
import neo4j from 'neo4j-driver';
import {buildPublicSchema} from '../../build_scripts/publicSchema.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createPipelineAttemptRepository} from '../../services/persistence/pipelineAttemptRepository.js';
import {createPipelineLeaseRepository} from '../../services/persistence/pipelineLeaseRepository.js';
import {pipelineLifecycleAttemptSelection,pipelineAttemptNumberSelection} from '../../customResolvers/contracts/pipelineLifecycleProjections.js';
import {executionPendingRunSelection} from '../../customResolvers/contracts/pipelineExecutorProjections.js';
import {PluginPipelineRunStatus,PluginPipelineRunTrigger} from '../../src/generated/graphql.js';
import {canonicalSelection,declaredSelection} from '../helpers/exactSelection.js';
test('eleven generated lifecycle documents retain actual selected payloads without invented mutation info',async()=>{
 const driver=neo4j.driver('bolt://127.0.0.1:1',neo4j.auth.basic('projection','unused'));
 try{
  const schema=await buildPublicSchema(),calls:{root:string;selection:string}[]=[];
  schema.getQueryType()!.getFields().pluginPipelineRuns.resolve=(_p,_a,_c,info)=>{const selection=info.fieldNodes[0].selectionSet;assert.ok(selection);calls.push({root:'pluginPipelineRuns',selection:canonicalSelection(selection)});return [];};
  for(const [root,field] of [['createPluginPipelineRuns','pluginPipelineRuns'],['updatePluginPipelineRuns','pluginPipelineRuns'],['updatePluginRuns','pluginRuns']])schema.getMutationType()!.getFields()[root].resolve=(_p,_a,_c,info)=>{const selection=info.fieldNodes[0].selectionSet;assert.ok(selection);calls.push({root,selection:canonicalSelection(selection)});return {[field]:[]};};
  registerGeneratedSchema(driver,schema);const attempt=createPipelineAttemptRepository(driver),lease=createPipelineLeaseRepository(driver);
  const stamp='2026-07-30T12:00:00Z',identity={pluginRunId:'job',leaseId:'lease'};
  const attemptPayload={pluginPipelineRuns:pipelineLifecycleAttemptSelection},jobPayload={pluginRuns:executionPendingRunSelection},identityPayload={pluginRuns:{id:true}};
  const cases:[string,Record<string,unknown>,()=>Promise<unknown>][]=[
   ['pluginPipelineRuns',pipelineAttemptNumberSelection,()=>attempt.findAttemptNumbers({})],
   ['createPluginPipelineRuns',attemptPayload,()=>attempt.createQueuedAttempt({pipelineId:'pipeline',targetId:'target',targetType:'Discussion',eventType:'event',scope:'SERVER',attemptNumber:1,configurationSnapshot:{},status:PluginPipelineRunStatus.Queued,trigger:PluginPipelineRunTrigger.Event,updatedAt:stamp})],
   ['updatePluginPipelineRuns',attemptPayload,()=>attempt.markRunning('pipeline',stamp)],
   ['updatePluginPipelineRuns',attemptPayload,()=>attempt.completeAttempt('pipeline',{})],
   ['updatePluginRuns',jobPayload,()=>lease.cancelOlderPendingJobs({}, {})],
   ['updatePluginRuns',identityPayload,()=>lease.claimPendingJob('job',{})],
   ['updatePluginRuns',identityPayload,()=>lease.renewOwnedJob(identity,{})],
   ['updatePluginRuns',jobPayload,()=>lease.extendPendingJobs('pipeline',stamp)],
   ['updatePluginPipelineRuns',attemptPayload,()=>lease.extendAttempt('pipeline',{})],
   ['updatePluginRuns',jobPayload,()=>lease.rescheduleOwnedJob(identity,{})],
   ['updatePluginRuns',jobPayload,()=>lease.completeOwnedJob(identity,{})],
  ];
  for(const [root,selection,invoke] of cases){calls.length=0;await invoke();assert.deepEqual(calls,[{root,selection:declaredSelection(selection)}],`${root}: lifecycle document drift`);}
  assert.equal(cases.length,11);
 }finally{await driver.close();}
});
