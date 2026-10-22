import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {initializeOgmFromExistingSchema} from '../../services/initializeOgmFromExistingSchema.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createPipelineWatchdogRepository} from '../../services/persistence/pipelineWatchdogRepository.js';
import {triggerPluginRunsForDownloadableFile} from '../../services/plugin/downloadTrigger.js';
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

const models=()=>({DownloadableFile:ogm.model('DownloadableFile'),ServerConfig:ogm.model('ServerConfig'),ServerSecret:ogm.model('ServerSecret'),PluginRun:ogm.model('PluginRun'),PluginPipelineRun:ogm.model('PluginPipelineRun'),Plugin:ogm.model('Plugin'),PluginVersion:ogm.model('PluginVersion')});
const old=()=>downloadExecutionRepositoryStub(models());
async function seed(){await driver.executeQuery(`CREATE (:DownloadableFile{id:'file',fileName:'fixture.zip',url:'https://fixture.invalid/file',kind:'ZIP',size:12,scanStatus:'CLEAN',priceModel:'FREE',createdAt:datetime('2020-01-01T00:00:00Z')}),(:PluginRun{id:'job',status:'PENDING',pluginId:'plugin',version:'1.0.0',scope:'SERVER',eventType:'fixture',createdAt:datetime('2020-01-01T00:00:00Z'),updatedAt:datetime('2020-01-01T00:00:00Z')})`);}
function normalize(value:unknown){const ids=new Map<string,string>();return JSON.parse(JSON.stringify(value,function(key,value){if(['id','id_from','id_to'].includes(key)){const identity=(key==='id'&&this.event?.includes('relationship')?'relationship:':'node:')+value;if(!ids.has(identity))ids.set(identity,`id${ids.size}`);return ids.get(identity);}return ['timestamp','createdAt','updatedAt','ageGateTouchedAt'].includes(key)&&value!==null?'<time>':value;}));}
// Multi-row reads have no guaranteed cross-run ordering, so deep-sort before snapshotting.
const sortDeep=(value:unknown):unknown=>Array.isArray(value)?value.map(sortDeep).sort((a,b)=>(JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0)):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,sortDeep(v)])):value;
async function state(){const nodes=(await driver.executeQuery('MATCH(n) RETURN labels(n)[0] AS label,properties(n) AS properties,toString(id(n)) AS nativeId ORDER BY labels(n)[0],coalesce(n.id,n.username)')).records.map(r=>r.toObject());const edges=(await driver.executeQuery('MATCH(a)-[r]->(b) RETURN type(r) AS type,toString(id(r)) AS id,toString(id(a)) AS fromId,toString(id(b)) AS toId')).records.map(r=>r.toObject());for(const event of events){assert.ok(Number.isFinite(event.timestamp));if(event.event==='create_relationship'){const edge=edges.find(r=>r.id===event.id);assert.ok(edge);assert.equal(edge.fromId,event.id_from);assert.equal(edge.toId,event.id_to);}else{const properties=event.properties.new;const node=nodes.find(n=>n.label===event.typename&&((properties.id&&n.properties.id===properties.id)||(properties.username&&n.properties.username===properties.username)));assert.ok(node);assert.equal(node.nativeId,event.id);}for(const properties of Object.values(event.properties) as any[]){if(!properties)continue;for(const field of ['createdAt','updatedAt','ageGateTouchedAt'])if(properties[field]!=null)assert.ok(Number.isFinite(Date.parse(String(properties[field]))));}}return normalize({nodes:nodes.map(({nativeId:_nativeId,...row})=>row),edgeTypes:edges.map(e=>e.type),events});}

test('finite reads preserve literal IDs, missing results and unbounded configurations/secrets',async(t)=>{
 await seed();await driver.executeQuery(`UNWIND range(1,29) AS n CREATE(:ServerConfig{serverName:toString(n)}),(:ServerSecret{key:toString(n),pluginId:$id,ciphertext:'synthetic-not-encrypted'})`,{id:'quote"\\id'});
 const repo=createDownloadExecutionRepository(driver);
 for(const id of ['file','missing','quote"\\id'])t.assert.snapshot(sortDeep(await repo.findFile(id)));
 t.assert.snapshot(sortDeep(await repo.findConfiguration()));assert.equal((await repo.findConfiguration()).length,29);
 for(const id of ['plugin','quote"\\id'])t.assert.snapshot(sortDeep(await repo.findSecrets(id)));assert.equal((await repo.findSecrets('quote"\\id')).length,29);
 for(const id of ['job','absent'])t.assert.snapshot(sortDeep(await repo.findReturnedRun(id)));
});
for(const operation of ['scan','create','skip'] as const)test(`${operation} retains default projection and ordered native events`,async(t)=>{
 async function check(){await seed();const repo=createDownloadExecutionRepository(driver);
 if(operation==='scan')await repo.writeScanState('file',{scanStatus:'PENDING',scanReason:null,reviewRequestedAt:null} as DownloadableFileUpdateInput);
 if(operation==='create'){const result=await repo.createPendingRuns([{pluginId:'plugin',version:'1.0.0',status:'PENDING',scope:'SERVER',eventType:'fixture',targetId:'file',targetType:'DownloadableFile',pipelineId:'pipeline',executionOrder:0,queuedAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z'} as PluginRunCreateInput]);assert.equal(result.pluginRuns.length,1);assert.ok(result.pluginRuns[0].id);assert.equal(result.pluginRuns[0].status,'PENDING');}
 if(operation==='skip')await repo.markSkippedRun('job',{status:'SKIPPED',skippedReason:'fixture',finishedAt:'2026-01-01T00:00:00Z',timeoutAt:null} as PluginRunUpdateInput);
 return state();}
 t.assert.snapshot(await check());
});
for(const failure of ['file','job'] as const)test(`${failure} default projection failure retains committed write`,async(t)=>{
 await schema(failure);try{async function check(){await seed();const repo=createDownloadExecutionRepository(driver);await assert.rejects(failure==='file'?repo.writeScanState('file',{scanReason:'changed'}):repo.markSkippedRun('job',{status:'SKIPPED'} as PluginRunUpdateInput),new RegExp(failure+' projection failed'));const result=await state();assert.equal(result.nodes.find((n:any)=>n.label===(failure==='file'?'DownloadableFile':'PluginRun')).properties[failure==='file'?'scanReason':'status'],failure==='file'?'changed':'SKIPPED');return result;}t.assert.snapshot(await check());}finally{await schema();}
});
test('generated validation precedes writes, missing updates preserve empty results',async()=>{await seed();const repo=createDownloadExecutionRepository(driver);await assert.rejects(repo.markSkippedRun('job',{status:123} as unknown as PluginRunUpdateInput),/String/);await assert.rejects(repo.createPendingRuns([{pluginId:'plugin',version:'1.0.0',scope:'SERVER',eventType:'fixture',status:'PENDING',executionOrder:'not-integer'} as unknown as PluginRunCreateInput]),/Int/);await repo.writeScanState('missing',{scanReason:null});await repo.markSkippedRun('missing',{message:null});assert.deepEqual(await repo.findReturnedRun('missing'),[]);assert.equal(events.length,0);});
test('actual trigger preserves guards and configured fake-plugin execution with disposable infrastructure',async()=>{
 {
  await resetDatabase(driver);events=[];await seed();const repository=createDownloadExecutionRepository(driver);const calls:string[]=[];
  const options={downloadRepository:repository,storage:{bucket(){throw Error('unexpected storage request');}},loadPlugin:async()=>{calls.push('loader');return class {async handleEvent(){calls.push('plugin');return {success:true,result:{message:'fixture-complete'}};}};}};
  await assert.rejects(triggerPluginRunsForDownloadableFile({driver,downloadableFileId:'file',event:'unsupported'},options),/Unsupported/);
  await assert.rejects(triggerPluginRunsForDownloadableFile({driver,downloadableFileId:'missing',event:'downloadableFile.created'},options),/not found/);
  assert.deepEqual(await triggerPluginRunsForDownloadableFile({driver,downloadableFileId:'file',event:'downloadableFile.created'},options),[]);
  await driver.executeQuery(`CREATE (s:ServerConfig{serverName:'fixture',pluginPipelines:$pipeline}),(p:Plugin{id:'plugin',name:'plugin'}),(v:PluginVersion{id:'version',version:'1.0.0',repoUrl:'fixture-only',entryPath:'index.js',manifest:$manifest}),(p)-[:HAS_VERSION]->(v),(s)-[:INSTALLED{enabled:true}]->(v)`,{pipeline:JSON.stringify([{event:'downloadableFile.created',steps:[{pluginId:'plugin'}]}]),manifest:JSON.stringify({events:['downloadableFile.created']})});
  const rows=await triggerPluginRunsForDownloadableFile({driver,downloadableFileId:'file',event:'downloadableFile.created'},options) as any[];
  assert.equal(rows.length,1);assert.equal(rows[0].status,'SUCCEEDED');assert.equal(rows[0].message,'fixture-complete');assert.deepEqual(calls,['loader','plugin']);
  const attempt=(await driver.executeQuery('MATCH(p:PluginPipelineRun) RETURN p.status AS status')).records;assert.equal(attempt.length,1);assert.equal(attempt[0].get('status'),'SUCCEEDED');
 }
});
