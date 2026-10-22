import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {initializeOgmFromExistingSchema} from '../../services/initializeOgmFromExistingSchema.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createPipelineWatchdogRepository} from '../../services/persistence/pipelineWatchdogRepository.js';
import {triggerPluginRunsForComment} from '../../services/plugin/commentTrigger.js';
import {createCommentExecutionRepository} from '../../services/persistence/commentExecutionRepository.js';
import {commentExecutionRepositoryStub} from '../fixtures/commentExecutionRepositoryStub.js';
import type {PluginRunCreateInput,PluginRunUpdateInput,DownloadableFileUpdateInput} from '../../ogm_types.js';
import {pipelineWatchdogRepositoryStub} from '../fixtures/pipelineWatchdogRepositoryStub.js';
import {pipelineAttemptRepositoryStub} from '../fixtures/pipelineAttemptRepositoryStub.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {resetDatabase,startNeo4j,stopNeo4j} from './neo4jHarness.js';
let driver:Driver;let ogm:ReturnType<typeof getCustomResolvers>['ogm'];const engine=createSubscriptionEngine();let events:any[]=[];
for(const kind of ['create','update','create_relationship','delete_relationship','delete'])engine.events.on(kind,event=>events.push(event));
async function schema(failure?:'file'|'job'){const app=getCustomResolvers(driver);const overrides:Record<string,Record<string,()=>never>>=failure==='file'?{DownloadableFile:{storageUrl:()=>{throw Error('file projection failed');}}}:failure==='job'?{PluginRun:{message:()=>{throw Error('job projection failed');}}}:{};const neo=new Neo4jGraphQL({driver,typeDefs,resolvers:{...app.resolvers,...overrides},features:{filters:{String:{MATCHES:true}},subscriptions:engine}});const executable=await neo.getSchema();ogm=app.ogm;initializeOgmFromExistingSchema(ogm,neo,executable);registerGeneratedSchema(driver,executable);}
before(async()=>{driver=await startNeo4j();await schema();},{timeout:240000});beforeEach(async()=>{await resetDatabase(driver);events=[];});after(async()=>{await engine.close();await stopNeo4j();});

const models=()=>({Comment:ogm.model('Comment'),Channel:ogm.model('Channel'),Discussion:ogm.model('Discussion'),Event:ogm.model('Event'),Issue:ogm.model('Issue'),User:ogm.model('User'),DownloadableFile:ogm.model('DownloadableFile'),ServerConfig:ogm.model('ServerConfig'),ServerSecret:ogm.model('ServerSecret'),PluginRun:ogm.model('PluginRun'),PluginPipelineRun:ogm.model('PluginPipelineRun'),Plugin:ogm.model('Plugin'),PluginVersion:ogm.model('PluginVersion')});
const old=()=>commentExecutionRepositoryStub(models());
async function seed(){await driver.executeQuery(`CREATE (:Comment{id:'comment',text:'fixture',createdAt:datetime('2020-01-01T00:00:00Z'),isRootComment:true}),(:Channel{uniqueName:'channel'}),(:DownloadableFile{id:'file',fileName:'fixture.zip',url:'https://fixture.invalid/file',kind:'ZIP',size:12,scanStatus:'CLEAN',priceModel:'FREE',createdAt:datetime('2020-01-01T00:00:00Z')}),(:PluginRun{id:'job',status:'PENDING',pluginId:'plugin',version:'1.0.0',scope:'SERVER',eventType:'fixture',createdAt:datetime('2020-01-01T00:00:00Z'),updatedAt:datetime('2020-01-01T00:00:00Z')})`);}
function normalize(value:unknown){const ids=new Map<string,string>();return JSON.parse(JSON.stringify(value,function(key,value){if(['id','id_from','id_to'].includes(key)){const identity=(key==='id'&&this.event?.includes('relationship')?'relationship:':'node:')+value;if(!ids.has(identity))ids.set(identity,`id${ids.size}`);return ids.get(identity);}return ['timestamp','createdAt','updatedAt','ageGateTouchedAt'].includes(key)&&value!==null?'<time>':value;}));}
async function state(){const nodes=(await driver.executeQuery('MATCH(n) RETURN labels(n)[0] AS label,properties(n) AS properties,toString(id(n)) AS nativeId ORDER BY labels(n)[0],coalesce(n.id,n.username)')).records.map(r=>r.toObject());const edges=(await driver.executeQuery('MATCH(a)-[r]->(b) RETURN type(r) AS type,toString(id(r)) AS id,toString(id(a)) AS fromId,toString(id(b)) AS toId')).records.map(r=>r.toObject());for(const event of events){assert.ok(Number.isFinite(event.timestamp));if(event.event==='create_relationship'){const edge=edges.find(r=>r.id===event.id);assert.ok(edge);assert.equal(edge.fromId,event.id_from);assert.equal(edge.toId,event.id_to);}else{const properties=event.properties.new;const node=nodes.find(n=>n.label===event.typename&&((properties.id&&n.properties.id===properties.id)||(properties.username&&n.properties.username===properties.username)));assert.ok(node);assert.equal(node.nativeId,event.id);}for(const properties of Object.values(event.properties) as any[]){if(!properties)continue;for(const field of ['createdAt','updatedAt','ageGateTouchedAt'])if(properties[field]!=null)assert.ok(Number.isFinite(Date.parse(String(properties[field]))));}}return normalize({nodes:nodes.map(({nativeId:_nativeId,...row})=>row),edgeTypes:edges.map(e=>e.type),events});}

test('finite reads preserve literal IDs, missing results and unbounded configurations/secrets',async()=>{
 await seed();await driver.executeQuery(`UNWIND range(1,29) AS n CREATE(:ServerConfig{serverName:toString(n)}),(:ServerSecret{key:toString(n),pluginId:$id,ciphertext:'synthetic-not-encrypted'})`,{id:'quote"\\id'});
 const repo=createCommentExecutionRepository(driver);
 for(const id of ['comment','missing','quote"\\id'])assert.deepEqual(await repo.findComment(id),await old().findComment(id));
 for(const id of ['channel','missing'])assert.deepEqual(await repo.findChannel(id),await old().findChannel(id));
 assert.deepEqual(await repo.findConfiguration(),await old().findConfiguration());assert.equal((await repo.findConfiguration()).length,29);
 for(const id of ['plugin','quote"\\id'])assert.deepEqual(await repo.findSecrets(id),await old().findSecrets(id));assert.equal((await repo.findSecrets('quote"\\id')).length,29);
 for(const id of ['job','absent'])assert.deepEqual(await repo.findReturnedRun(id),await old().findReturnedRun(id));
});
for(const operation of ['create','skip'] as const)test(`${operation} retains default projection and ordered native events`,async()=>{
 async function check(legacy:boolean){await seed();const repo=legacy?old():createCommentExecutionRepository(driver);
 if(operation==='create'){const result=await repo.createPendingRuns([{pluginId:'plugin',version:'1.0.0',status:'PENDING',scope:'SERVER',eventType:'fixture',targetId:'file',targetType:'DownloadableFile',pipelineId:'pipeline',executionOrder:0,queuedAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z'} as PluginRunCreateInput]);assert.equal(result.pluginRuns.length,1);assert.ok(result.pluginRuns[0].id);assert.equal(result.pluginRuns[0].status,'PENDING');}
 if(operation==='skip')await repo.markSkippedRun('job',{status:'SKIPPED',skippedReason:'fixture',finishedAt:'2026-01-01T00:00:00Z',timeoutAt:null} as PluginRunUpdateInput);
 return state();}
 const expected=await check(true);await resetDatabase(driver);events=[];assert.deepEqual(await check(false),expected);
});
for(const failure of ['job'] as const)test(`${failure} default projection failure retains committed write`,async()=>{
 await schema(failure);try{async function check(legacy:boolean){await seed();const repo=legacy?old():createCommentExecutionRepository(driver);await assert.rejects(repo.markSkippedRun('job',{status:'SKIPPED'} as PluginRunUpdateInput),new RegExp(failure+' projection failed'));const result=await state();assert.equal(result.nodes.find((n:any)=>n.label===('PluginRun')).properties['status'],'SKIPPED');return result;}const expected=await check(true);await resetDatabase(driver);events=[];assert.deepEqual(await check(false),expected);}finally{await schema();}
});
test('generated validation precedes writes, missing updates preserve empty results',async()=>{await seed();const repo=createCommentExecutionRepository(driver);await assert.rejects(repo.markSkippedRun('job',{status:123} as unknown as PluginRunUpdateInput),/String/);await assert.rejects(repo.createPendingRuns([{pluginId:'plugin',version:'1.0.0',scope:'SERVER',eventType:'fixture',status:'PENDING',executionOrder:'not-integer'} as unknown as PluginRunCreateInput]),/Int/);await repo.markSkippedRun('missing',{message:null});assert.deepEqual(await repo.findReturnedRun('missing'),[]);assert.equal(events.length,0);});

test('actual comment trigger preserves guards and fake-plugin execution',async()=>{
 for(const legacy of [true,false]){
  await resetDatabase(driver);events=[];await seed();const m=models();const repository=legacy?old():createCommentExecutionRepository(driver);const calls:string[]=[];
  const options={commentRepository:repository,loadPlugin:async()=>{calls.push('loader');return class {async handleEvent(){calls.push('plugin');return {success:true,result:{message:'fixture-complete'}};}};}};
  const args={driver,models:m,commentId:'comment',event:'comment.created'};
  await assert.rejects(triggerPluginRunsForComment({...args,event:'unsupported'},options),/Unsupported/);
  await assert.rejects(triggerPluginRunsForComment({...args,commentId:'missing'},options),/not found/);
  assert.deepEqual(await triggerPluginRunsForComment(args,options),[]);
  await driver.executeQuery(`MATCH(c:Comment{id:'comment'}),(channel:Channel{uniqueName:'channel'}) CREATE (dc:DiscussionChannel{id:'dc',discussionId:'discussion',channelUniqueName:'channel'}),(d:Discussion{id:'discussion',title:'fixture',body:'body'}),(dc)-[:CONTAINS_COMMENT]->(c),(dc)-[:POSTED_IN_CHANNEL]->(d),(channel)-[:HAS_COMMENT]->(c),(s:ServerConfig{serverName:'fixture'}),(p:Plugin{id:'plugin',name:'plugin'}),(v:PluginVersion{id:'version',version:'1.0.0',repoUrl:'fixture-only',entryPath:'index.js',manifest:$manifest}),(p)-[:HAS_VERSION]->(v),(s)-[:INSTALLED{enabled:true}]->(v)`,{manifest:JSON.stringify({events:[args.event]})});
  const selected=await repository.findComment('comment');assert.deepEqual(selected,await old().findComment('comment'));assert.equal(selected[0].DiscussionChannel?.Discussion?.id,'discussion');assert.equal(selected[0].DiscussionChannel?.Discussion?.body,'body');
  const rows=await triggerPluginRunsForComment(args,options) as any[];
  assert.equal(rows.length,1);assert.equal(rows[0].status,'SUCCEEDED');assert.equal(rows[0].targetType,'Comment');assert.equal(rows[0].message,'fixture-complete');assert.deepEqual(calls,['loader','plugin']);
  const attempt=(await driver.executeQuery('MATCH(p:PluginPipelineRun) RETURN p.status AS status')).records;assert.equal(attempt.length,1);assert.equal(attempt[0].get('status'),'SUCCEEDED');
 }
});
test('comment union-author and age-gate read contracts remain schema-owned',async()=>{
 await seed();await driver.executeQuery(`MATCH(c:Comment{id:'comment'}) CREATE(u:User{username:'author',displayName:'Author'}),(u)-[:AUTHORED_COMMENT]->(c),(:Comment{id:'restricted',ageGateRestricted:true,text:'hidden',createdAt:datetime('2020-01-01T00:00:00Z')})`);
 const repo=createCommentExecutionRepository(driver);assert.deepEqual(await repo.findComment('comment'),await old().findComment('comment'));assert.equal(((await repo.findComment('comment'))[0].CommentAuthor as {username?:string}|null)?.username,'author');assert.deepEqual(await repo.findComment('restricted'),await old().findComment('restricted'));assert.deepEqual(await repo.findComment('restricted'),[]);
 await driver.executeQuery(`MATCH(u:User{username:'author'})-[r:AUTHORED_COMMENT]->(c:Comment{id:'comment'}) DELETE r CREATE (m:ModerationProfile{displayName:'Moderator'}),(u)-[:MODERATION_PROFILE]->(m),(m)-[:AUTHORED_COMMENT]->(c)`);
 const moderationRows=await repo.findComment('comment');assert.deepEqual(moderationRows,await old().findComment('comment'));const author=moderationRows[0].CommentAuthor as {displayName?:string,User?:{username?:string}};assert.equal(author.displayName,'Moderator');assert.equal(author.User?.username,'author');
});
