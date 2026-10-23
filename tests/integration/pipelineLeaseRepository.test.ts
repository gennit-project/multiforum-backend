import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import { createPipelineLeaseRepository, type PipelineLeaseRepository } from '../../services/persistence/pipelineLeaseRepository.js';
import { createPluginEventQueueRepository } from '../../services/persistence/pluginEventQueueRepository.js';
import {cancelSupersededPluginRuns,claimPluginRunLease,renewPluginRunLease,completePluginRunLease} from '../../services/plugin/executionLease.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {resetDatabase,startNeo4j,stopNeo4j} from './neo4jHarness.js';
let driver:Driver;const engine=createSubscriptionEngine();let events:any[]=[];
for(const kind of ['create','update','create_relationship','delete_relationship','delete'])engine.events.on(kind,event=>events.push(event));
async function schema(failure?:'attempt'|'job'){const app=getCustomResolvers(driver);const overrides:Record<string,Record<string,()=>never>>=failure==='attempt'?{PluginPipelineRun:{targetVersion:()=>{throw Error('attempt projection failed');}}}:failure==='job'?{PluginRun:{message:()=>{throw Error('job projection failed');}}}:{};const neo=new Neo4jGraphQL({driver,typeDefs,resolvers:{...app.resolvers,...overrides},features:{filters:{String:{MATCHES:true}},subscriptions:engine}});const executable=await neo.getSchema();registerGeneratedSchema(driver,executable);}
before(async()=>{driver=await startNeo4j();await schema();},{timeout:240000});beforeEach(async()=>{await resetDatabase(driver);events=[];});after(async()=>{await engine.close();await stopNeo4j();});
const now=new Date('2026-07-30T12:00:00.000Z');const later=new Date('2026-07-30T12:00:30.000Z');
const lease={pluginRunId:'job',pipelineId:'pipeline',leaseId:'lease / "'};
async function seed(){await driver.executeQuery(`CREATE(p:PluginPipelineRun{id:'attempt',pipelineId:'pipeline',targetId:'file',targetType:'DownloadableFile',eventType:'fixture',scope:'SERVER',status:'RUNNING',trigger:'EVENT',attemptNumber:1,configurationSnapshot:'{}',createdAt:datetime('2020-01-01T00:00:00Z'),updatedAt:datetime('2020-01-01T00:00:00Z')}) WITH p UNWIND ['job','sibling'] AS name CREATE(:PluginRun{id:name,pluginId:'plugin',version:'1.0.0',scope:'SERVER',eventType:'fixture',pipelineId:'pipeline',status:'PENDING',createdAt:datetime('2020-01-01T00:00:00Z'),updatedAt:datetime('2020-01-01T00:00:00Z')})`);}
function normalize(value:unknown){const ids=new Map<string,string>();return JSON.parse(JSON.stringify(value,function(key,value){if(['id','id_from','id_to'].includes(key)){const identity=(key==='id'&&this.event?.includes('relationship')?'relationship:':'node:')+value;if(!ids.has(identity))ids.set(identity,`id${ids.size}`);return ids.get(identity);}return ['timestamp','updatedAt'].includes(key)&&value!==null?'<time>':value;}));}
async function state(){const rows=(await driver.executeQuery(`MATCH(n) WHERE n:PluginRun OR n:PluginPipelineRun RETURN n.id AS id,labels(n)[0] AS label,n.status AS status,n.leaseId AS leaseId,toString(n.startedAt) AS started,toString(n.heartbeatAt) AS heartbeat,toString(n.timeoutAt) AS timeout,toString(n.finishedAt) AS finished,toString(id(n)) AS nativeId ORDER BY n.id`)).records.map(r=>r.toObject());for(const event of events){const row=rows.find(r=>r.id===event.properties?.new?.id);assert.ok(row);assert.equal(event.id,row.nativeId);assert.ok(Number.isFinite(event.timestamp));assert.ok(Number.isFinite(Date.parse(String(event.properties.new.updatedAt))));}return normalize({rows:rows.map(({nativeId:_nativeId,...row})=>row),events});}
const claim=(repository:PipelineLeaseRepository,leaseId=lease.leaseId)=>claimPluginRunLease({repository,pluginRunId:lease.pluginRunId,pipelineId:lease.pipelineId,leaseId,now,leaseDurationMs:60000});
const renew=(repository:PipelineLeaseRepository,identity=lease)=>renewPluginRunLease({repository,lease:identity,now:later,leaseDurationMs:60000});
const complete=(repository:PipelineLeaseRepository,identity=lease)=>completePluginRunLease({repository,lease:identity,update:{status:'SUCCEEDED',message:'done'},now:later});
test('claim, heartbeat sibling extension, completion retain exact responses and ordered native events',async(t)=>{async function run(repository:PipelineLeaseRepository){await seed();assert.deepEqual(await claim(repository),lease);assert.equal(await renew(repository),true);const result=await complete(repository);assert.equal(result.pluginRuns[0].status,'SUCCEEDED');return {result:normalize(result),state:await state()};}const result=await run(createPipelineLeaseRepository(driver));assert.deepEqual(result.state.rows.map((r:any)=>[r.label,r.status,r.timeout]),[['PluginPipelineRun','RUNNING','2026-07-30T12:01:30Z'],['PluginRun','SUCCEEDED',null],['PluginRun','PENDING','2026-07-30T12:01:30Z']]);t.assert.snapshot(result);});
test('second claimant and stale owner cannot renew or complete after first committed claim',async(t)=>{async function run(repository:PipelineLeaseRepository){await seed();assert.ok(await claim(repository));const expected=await state();assert.equal(await claim(repository,'loser'),null);assert.equal(await renew(repository,{...lease,leaseId:'loser'}),false);assert.equal((await complete(repository,{...lease,leaseId:'loser'})).pluginRuns.length,0);assert.deepEqual(await state(),expected);return expected;}t.assert.snapshot(await run(createPipelineLeaseRepository(driver)));});
test('missing job retains null claim and no writes; generated input validation matches',async()=>{for(const repo of [createPipelineLeaseRepository(driver)]){assert.equal(await claim(repo),null);assert.equal(await renew(repo),false);assert.equal((await complete(repo)).pluginRuns.length,0);}assert.equal(events.length,0);await assert.rejects(createPipelineLeaseRepository(driver).claimPendingJob('job',{heartbeatAt:'invalid'}),/DateTime cannot represent non temporal value/);});
test('newer content revision cancels only matching older pending jobs',async()=>{
 await driver.executeQuery(`
  UNWIND [
   {id:'older', pluginId:'moderator', targetId:'discussion', queuedAt:datetime('2026-07-30T11:59:00Z')},
   {id:'newer', pluginId:'moderator', targetId:'discussion', queuedAt:datetime('2026-07-30T12:02:00Z')},
   {id:'other-plugin', pluginId:'other', targetId:'discussion', queuedAt:datetime('2026-07-30T11:59:00Z')},
   {id:'other-target', pluginId:'moderator', targetId:'other', queuedAt:datetime('2026-07-30T11:59:00Z')}
  ] AS job
  CREATE (:PluginRun {
   id:job.id, pluginId:job.pluginId, version:'1.0.0', scope:'CHANNEL', channelId:'cats',
   eventType:'discussionChannel.created', status:'PENDING', targetId:job.targetId,
   targetType:'Discussion', pipelineId:job.id, queuedAt:job.queuedAt,
   createdAt:datetime('2026-07-30T11:00:00Z'), updatedAt:datetime('2026-07-30T11:00:00Z')
  })
 `);
 const result=await cancelSupersededPluginRuns({
  repository:createPipelineLeaseRepository(driver),
  currentRun:{id:'current',pluginId:'moderator',pipelineId:'current-pipeline',scope:'CHANNEL',channelId:'cats',targetId:'discussion',targetType:'Discussion',queuedAt:'2026-07-30T12:01:00.000Z'},
  now:new Date('2026-07-30T12:01:01.000Z'),
 });
 assert.deepEqual(result.pluginRuns.map(run=>run.id),['older']);
 const rows=(await driver.executeQuery(`MATCH(run:PluginRun) RETURN run.id AS id,run.status AS status ORDER BY run.id`)).records.map(record=>record.toObject());
 assert.deepEqual(rows,[
  {id:'newer',status:'PENDING'},
  {id:'older',status:'CANCELLED'},
  {id:'other-plugin',status:'PENDING'},
  {id:'other-target',status:'PENDING'},
 ]);
});
test('atomic event claims enforce concurrency across competing workers',async()=>{
 await driver.executeQuery(`
  CREATE (:ServerConfig {serverName:'test'})
  WITH 1 AS ignored
  UNWIND ['one','two'] AS suffix
  CREATE (:PluginPipelineRun {
   id:'attempt-'+suffix,pipelineId:'pipeline-'+suffix,targetId:'comment-'+suffix,
   targetType:'Comment',eventType:'comment.created',scope:'SERVER',status:'QUEUED',
   trigger:'EVENT',attemptNumber:1,configurationSnapshot:'{}',
   createdAt:datetime('2026-07-30T11:00:00Z'),updatedAt:datetime('2026-07-30T11:00:00Z')
  })
  CREATE (:PluginRun {
   id:'job-'+suffix,pluginId:'moderator',version:'1.0.0',scope:'SERVER',
   eventType:'comment.created',status:'PENDING',targetId:'comment-'+suffix,
   targetType:'Comment',pipelineId:'pipeline-'+suffix,deferred:true,
   createdAt:datetime('2026-07-30T11:00:00Z'),updatedAt:datetime('2026-07-30T11:00:00Z')
  })
 `);
 const repository=createPipelineLeaseRepository(driver);
 const claimEvent=(suffix:string)=>claimPluginRunLease({
  repository,
  pluginRunId:`job-${suffix}`,
  pipelineId:`pipeline-${suffix}`,
  leaseId:`lease-${suffix}`,
  now,
  leaseDurationMs:60000,
  claimLimits:{concurrency:1,rateLimitPerMinute:30,windowStart:'2026-07-30T11:59:00.000Z'},
 });
 const claims=await Promise.all([claimEvent('one'),claimEvent('two')]);
 assert.equal(claims.filter(Boolean).length,1);
 const statuses=(await driver.executeQuery(`MATCH(job:PluginRun) RETURN job.status AS status`)).records.map(record=>record.get('status')).sort();
 assert.deepEqual(statuses,['PENDING','RUNNING']);
});
test('atomic event claims include completed starts in the rolling rate window',async()=>{
 await driver.executeQuery(`
  CREATE (:ServerConfig {serverName:'test'})
  WITH 1 AS ignored
  CREATE (:PluginPipelineRun {
   id:'attempt',pipelineId:'pipeline',targetId:'comment',targetType:'Comment',
   eventType:'comment.created',scope:'SERVER',status:'QUEUED',trigger:'EVENT',
   attemptNumber:1,configurationSnapshot:'{}',createdAt:datetime('2026-07-30T11:00:00Z'),
   updatedAt:datetime('2026-07-30T11:00:00Z')
  })
  CREATE (:PluginRun {
   id:'recent',pluginId:'moderator',version:'1.0.0',scope:'SERVER',eventType:'comment.created',
   status:'SUCCEEDED',targetType:'Comment',deferred:true,startedAt:datetime('2026-07-30T11:59:30Z'),
   createdAt:datetime('2026-07-30T11:00:00Z'),updatedAt:datetime('2026-07-30T11:00:00Z')
  })
  CREATE (:PluginRun {
   id:'job',pluginId:'moderator',version:'1.0.0',scope:'SERVER',eventType:'comment.created',
   status:'PENDING',targetId:'comment',targetType:'Comment',pipelineId:'pipeline',deferred:true,
   createdAt:datetime('2026-07-30T11:00:00Z'),updatedAt:datetime('2026-07-30T11:00:00Z')
  })
 `);
 const lease=await claimPluginRunLease({
  repository:createPipelineLeaseRepository(driver),pluginRunId:'job',pipelineId:'pipeline',
  leaseId:'rate-limited',now,leaseDurationMs:60000,
  claimLimits:{concurrency:2,rateLimitPerMinute:1,windowStart:'2026-07-30T11:59:00.000Z'},
 });
 assert.equal(lease,null);
 const status=(await driver.executeQuery(`MATCH(job:PluginRun{id:'job'}) RETURN job.status AS status`)).records[0].get('status');
 assert.equal(status,'PENDING');
});
test('event queue repository returns oldest eligible attempts and ordered jobs',async()=>{
 await driver.executeQuery(`
  UNWIND [
   {suffix:'older',queuedAt:datetime('2026-07-30T11:58:00Z')},
   {suffix:'newer',queuedAt:datetime('2026-07-30T11:59:00Z')}
  ] AS item
  CREATE (:PluginPipelineRun {
   id:'attempt-'+item.suffix,pipelineId:'pipeline-'+item.suffix,targetId:'comment-'+item.suffix,
   targetType:'Comment',targetVersion:'revision',eventType:'comment.created',scope:'SERVER',
   status:'QUEUED',trigger:'EVENT',attemptNumber:1,configurationSnapshot:'{}',
   queuedAt:item.queuedAt,createdAt:item.queuedAt,updatedAt:item.queuedAt
  })
  CREATE (:PluginRun {
   id:'job-'+item.suffix+'-1',pluginId:'moderator',version:'1.0.0',scope:'SERVER',
   eventType:'comment.created',status:'PENDING',targetId:'comment-'+item.suffix,
   targetType:'Comment',targetVersion:'revision',pipelineId:'pipeline-'+item.suffix,
   executionOrder:1,deferred:true,createdAt:item.queuedAt,updatedAt:item.queuedAt
  })
  CREATE (:PluginRun {
   id:'job-'+item.suffix+'-0',pluginId:'moderator',version:'1.0.0',scope:'SERVER',
   eventType:'comment.created',status:'SUCCEEDED',targetId:'comment-'+item.suffix,
   targetType:'Comment',targetVersion:'revision',pipelineId:'pipeline-'+item.suffix,
   executionOrder:0,deferred:true,startedAt:datetime('2026-07-30T11:59:30Z'),
   createdAt:item.queuedAt,updatedAt:item.queuedAt
  })
 `);
 const repository=createPluginEventQueueRepository(driver);
 const capacity=await repository.getCapacity('2026-07-30T11:59:00.000Z');
 const attempts=await repository.findQueuedAttempts(1);
 const runs=await repository.findRuns('pipeline-older');
 await repository.failPendingAttempt('pipeline-newer','target was deleted','2026-07-30T12:00:00.000Z');
 const failed=(await driver.executeQuery(`
  MATCH(node) WHERE node.pipelineId='pipeline-newer'
  RETURN labels(node)[0] AS label,node.id AS id,node.status AS status,node.message AS message
  ORDER BY label,id
 `)).records.map(record=>record.toObject());
 assert.deepEqual({
  capacity,
  attempts:attempts.map(attempt=>attempt.pipelineId),
  runOrders:runs.map(run=>run.executionOrder),
  failed,
 },{
  capacity:{runningCount:0,recentStartCount:2},
  attempts:['pipeline-older'],
  runOrders:[0,1],
  failed:[
   {label:'PluginPipelineRun',id:'attempt-newer',status:'FAILED',message:null},
   {label:'PluginRun',id:'job-newer-0',status:'SUCCEEDED',message:null},
   {label:'PluginRun',id:'job-newer-1',status:'FAILED',message:'target was deleted'},
  ],
 });
});
test('attempt projection error retains committed job claim and parent update',async(t)=>{await schema('attempt');try{await seed();await assert.rejects(claim(createPipelineLeaseRepository(driver)),/attempt projection failed/);const expected=await state();assert.equal(expected.rows[1].status,'RUNNING');assert.ok(expected.rows[0].heartbeat);t.assert.snapshot(expected);}finally{await schema();}});
test('pending sibling projection error preserves renewed job and siblings but prevents parent renewal',async(t)=>{await schema('job');try{async function run(repository:PipelineLeaseRepository){await seed();await claim(repository);await assert.rejects(renew(repository),/job projection failed/);const value=await state();assert.equal(value.rows[0].heartbeat,'2026-07-30T12:00:00Z');assert.equal(value.rows[1].heartbeat,'2026-07-30T12:00:30Z');assert.equal(value.rows[2].timeout,'2026-07-30T12:01:30Z');return value;}t.assert.snapshot(await run(createPipelineLeaseRepository(driver)));}finally{await schema();}});
test('completion projection error commits terminal state and prevents retry mutation',async(t)=>{await schema('job');try{async function run(repository:PipelineLeaseRepository){await seed();await claim(repository);await assert.rejects(complete(repository),/job projection failed/);const expected=await state();assert.equal(expected.rows[1].status,'SUCCEEDED');assert.equal((await complete(repository)).pluginRuns.length,0);assert.deepEqual(await state(),expected);return expected;}t.assert.snapshot(await run(createPipelineLeaseRepository(driver)));}finally{await schema();}});
