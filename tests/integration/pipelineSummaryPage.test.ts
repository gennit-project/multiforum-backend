import assert from 'node:assert/strict';
import {before, after, beforeEach, test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import {graphql} from 'graphql';
import {applyMiddleware} from 'graphql-middleware';
import permissions from '../../permissions.js';
import sourceIdentity from '../../middleware/userChildIdentityMiddleware.js';
import neo4j, {type Driver} from 'neo4j-driver';
import typeDefs from '../../typeDefs.js';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createPipelineSummaryPage, createPipelineRunPage} from '../../customResolvers/queries/getPluginPipelinePage.js';
import {ensurePipelineSummaryIndexes} from '../../services/pipelineSummaryIndexes.js';
import {startNeo4j, stopNeo4j, resetDatabase} from './neo4jHarness.js';

let driver: Driver;
let summary: ReturnType<typeof createPipelineSummaryPage>;
let detail: ReturnType<typeof createPipelineRunPage>;
let schema: Awaited<ReturnType<Neo4jGraphQL['getSchema']>>;
before(async () => {
  driver = await startNeo4j();
  const app = getCustomResolvers(driver);
  schema = await new Neo4jGraphQL({typeDefs, driver, resolvers: app.resolvers, features: {filters: {String: {MATCHES: true}}, subscriptions: true}}).getSchema();
  registerGeneratedSchema(driver, schema);
  await ensurePipelineSummaryIndexes(driver);
  summary = createPipelineSummaryPage({driver});
  detail = createPipelineRunPage({driver});
}, {timeout: 240000});
after(async () => stopNeo4j());
beforeEach(async () => {
  await resetDatabase(driver);
  await driver.executeQuery(`CREATE (d:Discussion {id:'discussion', deleted:false})-[:HAS_DOWNLOADABLE_FILE]->(:DownloadableFile {id:'file'})
    CREATE (:DiscussionChannel {id:'post', channelUniqueName:'cats', archived:false})-[:POSTED_IN_CHANNEL]->(d)`);
});
const args = {targetId:'file', targetType:'DownloadableFile'};
async function seed(count: number, jobs: number) {
  await driver.executeQuery(`UNWIND range(1, $count) AS n
    CREATE (a:PluginPipelineRun {id:'attempt-'+toString(n), pipelineId:'pipeline-'+toString(n), targetId:'file', targetType:'DownloadableFile', scope:'SERVER', eventType:'downloadableFile.created', status:'SUCCEEDED', trigger:'EVENT', attemptNumber:n, configurationSnapshot:'private config', createdAt:datetime('2026-01-01T00:00:00Z'), updatedAt:datetime('2026-01-01T00:00:00Z')})
    WITH a UNWIND range(1, $jobs) AS j
    CREATE (:PluginRun {id:a.id+'-job-'+toString(j), pipelineId:a.pipelineId, targetId:a.targetId, targetType:a.targetType, scope:a.scope, eventType:a.eventType, pluginId:'scanner', version:'1', status:'SUCCEEDED', executionOrder:j, payload:'private payload', message:'private message', publicDiagnostics:'[]', createdAt:a.createdAt, updatedAt:a.updatedAt})`, {count:neo4j.int(count), jobs:neo4j.int(jobs)});
}
test('empty visible target, invalid bounds/cursors and missing attempt', async () => {
  const result = await summary(null, args);
  assert.deepEqual(result, {...args, hasActiveWork:false, hasFailedWork:false, pageInfo:{hasNextPage:false,endCursor:null}, attempts:[]});
  assert.equal(await detail(null, {pipelineRunId:'missing'}), null);
  await assert.rejects(summary(null, {...args, first:51}), /Page size/);
  await assert.rejects(summary(null, {...args, jobsFirst:101}), /Page size/);
  await assert.rejects(summary(null, {...args, after:'no'}), /Invalid/);
});
test('attempt ties, exact boundaries, concurrent newer insert and cursor binding', async () => {
  await seed(4, 1);
  const first = await summary(null, {...args, first:2});
  assert.deepEqual(first.attempts.map(a=>a.run.id), ['attempt-4','attempt-3']);
  assert.equal(first.pageInfo.hasNextPage, true);
  await driver.executeQuery(`MATCH (a:PluginPipelineRun {id:'attempt-4'}) CREATE (b:PluginPipelineRun) SET b=properties(a), b.id='new', b.pipelineId='new', b.createdAt=datetime('2026-02-01T00:00:00Z')`);
  const second = await summary(null, {...args, first:2, after:first.pageInfo.endCursor});
  assert.deepEqual(second.attempts.map(a=>a.run.id), ['attempt-2','attempt-1']);
  assert.equal(second.pageInfo.hasNextPage, false);
  await assert.rejects(summary(null, {...args, scope:'SERVER', after:first.pageInfo.endCursor}), /Invalid/);
  const empty = await summary(null, {...args, after:second.pageInfo.endCursor});
  assert.equal(empty.attempts.length, 0);
});
test('bounded fan-out, omitted active/failed jobs, public redaction and job pagination', async () => {
  await seed(3, 250);
  await driver.executeQuery(`MATCH (j:PluginRun {id:'attempt-3-job-250'}) SET j.status='FAILED', j.publicDiagnostics='[{"level":"ERROR","code":"SCAN_FAILED","message":"failed"}]'`);
  await driver.executeQuery(`MATCH (j:PluginRun {id:'attempt-1-job-250'}) SET j.status='RUNNING'`);
  const result = await summary(null, {...args, first:1, jobsFirst:2});
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].run.jobs.length, 2);
  assert.equal(result.attempts[0].displayStatus, 'FAILED');
  assert.equal(result.hasActiveWork, true);
  assert.equal(result.hasFailedWork, true);
  assert.equal(result.attempts[0].jobsPageInfo.hasNextPage, true);
  assert.ok(!JSON.stringify(result).includes('private'));
  const next = await detail(null, {pipelineRunId:'attempt-3', first:2, after:result.attempts[0].jobsPageInfo.endCursor});
  assert.deepEqual(next?.run.jobs.map(j=>j.executionOrder), [3,4]);
  assert.equal(next?.displayStatus, 'FAILED');
  await assert.rejects(detail(null, {pipelineRunId:'attempt-2', after:result.attempts[0].jobsPageInfo.endCursor}), /Invalid/);
  const active = await detail(null, {pipelineRunId:'attempt-1', first:1});
  assert.equal(active?.hasActiveWork, true);
  assert.equal(active?.displayStatus, 'RUNNING');
});
test('job ordering handles null orders, ties and concurrent inserts without duplicate rows', async () => {
  await seed(1, 4);
  await driver.executeQuery('MATCH (j:PluginRun) SET j.executionOrder=null');
  const first = await detail(null, {pipelineRunId:'attempt-1', first:2});
  assert.deepEqual(first?.run.jobs.map(j=>j.id), ['attempt-1-job-4','attempt-1-job-3']);
  await driver.executeQuery(`MATCH (j:PluginRun {id:'attempt-1-job-4'}) CREATE (new:PluginRun) SET new=properties(j), new.id='new', new.createdAt=datetime('2026-02-01T00:00:00Z')`);
  const next = await detail(null, {pipelineRunId:'attempt-1', first:2, after:first?.jobsPageInfo.endCursor});
  assert.deepEqual(next?.run.jobs.map(j=>j.id), ['attempt-1-job-2','attempt-1-job-1']);
  assert.equal(next?.jobsPageInfo.hasNextPage, false);
});
test('target, scope and channel filtering isolate jobs and authoritative flags', async () => {
  await seed(2, 2);
  await driver.executeQuery(`MATCH (a:PluginPipelineRun {id:'attempt-1'}) SET a.scope='CHANNEL', a.channelId='cats'
    WITH a MATCH (j:PluginRun {pipelineId:a.pipelineId}) SET j.scope='CHANNEL', j.channelId='cats', j.status='RUNNING'`);
  await driver.executeQuery(`CREATE (:PluginRun {id:'foreign', pipelineId:'pipeline-2', targetId:'other', targetType:'DownloadableFile', scope:'SERVER', status:'FAILED', executionOrder:0})`);
  const server = await summary(null, {...args, scope:'SERVER'});
  assert.equal(server.hasActiveWork, false);
  assert.equal(server.hasFailedWork, false);
  assert.deepEqual(server.attempts.map(a=>a.run.id), ['attempt-2']);
  assert.equal(server.attempts[0].displayStatus, 'SUCCEEDED');
  assert.equal(server.attempts[0].run.jobs.length, 2);
  const cats = await summary(null, {...args, scope:'CHANNEL', channelId:'cats'});
  assert.equal(cats.hasActiveWork, true);
  assert.deepEqual(cats.attempts.map(a=>a.run.id), ['attempt-1']);
  const dogs = await summary(null, {...args, channelId:'dogs'});
  assert.equal(dogs.hasActiveWork, false);
  assert.equal(dogs.attempts.length, 0);
});
test('queued attempts without jobs keep polling; hidden targets block both public endpoints', async () => {
  await seed(1, 1);
  await driver.executeQuery(`MATCH (j:PluginRun) DELETE j`);
  await driver.executeQuery(`MATCH (a:PluginPipelineRun) SET a.status='QUEUED'`);
  const result = await summary(null, args);
  assert.equal(result.hasActiveWork, true);
  assert.equal(result.attempts[0].displayStatus, 'PENDING');
  await driver.executeQuery(`MATCH (d:Discussion) SET d.deleted=true`);
  await assert.rejects(summary(null, args), /Pipeline target not found/);
  await assert.rejects(detail(null, {pipelineRunId:'attempt-1'}), /Pipeline target not found/);
});
test('public GraphQL documents validate and legacy summary remains complete', async () => {
  await seed(2, 3);
  const result = await graphql({schema:applyMiddleware(schema, permissions), contextValue: {driver,req:{headers:{},body:{},isMutation:false}}, source:`{ getPipelineSummaryPage(targetId:"file", targetType:"DownloadableFile", first:1, jobsFirst:1) {
    hasActiveWork hasFailedWork pageInfo {hasNextPage endCursor} attempts {displayStatus hasActiveWork jobsPageInfo {hasNextPage endCursor} run {id status jobs {id status diagnostics {code}}}}
  } getPipelineSummary(targetId:"file", targetType:"DownloadableFile") {attempts {id jobs {id}}} }`});
  assert.equal(result.errors, undefined);
  const data = result.data as {getPipelineSummary:{attempts:{jobs:unknown[]}[]}};
  assert.equal(data.getPipelineSummary.attempts.length, 2);
  assert.equal(data.getPipelineSummary.attempts[0].jobs.length, 3);
});
test('event filters precede pagination and skipped status examines every job', async () => {
  await seed(3, 3);
  await driver.executeQuery(`MATCH (a:PluginPipelineRun {id:'attempt-3'}) SET a.eventType='other'
    WITH a MATCH (j:PluginRun {pipelineId:a.pipelineId}) SET j.eventType='other', j.status='RUNNING'`);
  await driver.executeQuery(`MATCH (j:PluginRun {pipelineId:'pipeline-2'}) SET j.status='SKIPPED'`);
  const result = await summary(null, {...args,eventType:'downloadableFile.created',first:1,jobsFirst:1});
  assert.equal(result.attempts[0].run.id, 'attempt-2');
  assert.equal(result.hasActiveWork, false);
  assert.equal(result.attempts[0].displayStatus, 'SKIPPED');
  await driver.executeQuery(`MATCH (j:PluginRun {id:'attempt-2-job-3'}) SET j.status='SUCCEEDED'`);
  const changed = await summary(null, {...args,eventType:'downloadableFile.created',first:1,jobsFirst:1});
  assert.equal(changed.attempts[0].displayStatus, 'SUCCEEDED');
});

test('named-zone timestamps remain usable in attempt and job cursors', async () => {
  await seed(2, 2);
  await driver.executeQuery(`MATCH (a:PluginPipelineRun) SET a.createdAt=datetime('2026-01-01T12:00:00Z[Europe/London]')`);
  await driver.executeQuery(`MATCH (j:PluginRun) SET j.createdAt=datetime('2026-01-01T12:00:00Z[Europe/London]')`);
  const first = await summary(null, {...args,first:1,jobsFirst:1});
  const second = await summary(null, {...args,first:1,after:first.pageInfo.endCursor});
  assert.deepEqual(second.attempts.map(a=>a.run.id), ['attempt-1']);
  const jobs = await detail(null, {pipelineRunId:'attempt-2',first:1,after:first.attempts[0].jobsPageInfo.endCursor});
  assert.deepEqual(jobs?.run.jobs.map(j=>j.executionOrder), [2]);
});
test('older legacy pipeline bookmarks paginate jobs and preserve target visibility', async () => {
  await seed(2, 3);
  const recent = await summary(null, {...args, first:1});
  assert.equal(recent.attempts[0].run.id, 'attempt-2');
  const legacy = await detail(null, {pipelineRunId:'pipeline-1',first:1});
  assert.equal(legacy?.run.id, 'attempt-1');
  const next = await detail(null, {pipelineRunId:'pipeline-1',first:1,after:legacy?.jobsPageInfo.endCursor});
  assert.deepEqual(next?.run.jobs.map(j=>j.executionOrder), [2]);
  const canonical = await detail(null, {pipelineRunId:'attempt-1',first:1,after:legacy?.jobsPageInfo.endCursor});
  assert.deepEqual(canonical, next);
  await driver.executeQuery(`MATCH (d:Discussion) SET d.deleted=true`);
  await assert.rejects(detail(null, {pipelineRunId:'pipeline-1'}), /Pipeline target not found/);
});
test('an exact attempt ID takes precedence over a matching legacy pipeline identifier', async () => {
  await seed(2, 1);
  await driver.executeQuery(`MATCH (a:PluginPipelineRun {id:'attempt-1'}) CREATE (b:PluginPipelineRun)
    SET b=properties(a), b.id='pipeline-2', b.pipelineId='exact-id-precedence'`);
  const result = await detail(null, {pipelineRunId:'pipeline-2'});
  assert.equal(result?.run.id, 'pipeline-2');
  assert.equal(result?.run.pipelineId, 'exact-id-precedence');
});

test('cursor branches preserve missing-key exclusion and filtered tie ordering', async()=>{
  await seed(6,1);
  await driver.executeQuery("MATCH(a:PluginPipelineRun) WHERE a.id IN ['attempt-1','attempt-2'] SET a.createdAt=datetime('2025-12-31T00:00:00Z')");
  await driver.executeQuery("MATCH(a:PluginPipelineRun{id:'attempt-3'}) SET a.eventType='other'");
  await driver.executeQuery(`CREATE(:PluginPipelineRun{targetId:'file',targetType:'DownloadableFile',id:'missing-date',scope:'SERVER',eventType:'downloadableFile.created'})
    CREATE(:PluginPipelineRun{targetId:'file',targetType:'DownloadableFile',createdAt:datetime('2025-12-30T00:00:00Z'),scope:'SERVER',eventType:'downloadableFile.created'})
    CREATE(:PluginPipelineRun{targetId:'file',targetType:'DownloadableFile',createdAt:datetime('2026-01-01T00:00:00Z'),scope:'SERVER',eventType:'downloadableFile.created'})`);
  const first=await summary(null,{...args,eventType:'downloadableFile.created',first:1,jobsFirst:1});
  assert.deepEqual(first.attempts.map(row=>row.run.id),['attempt-6']);
  const next=await summary(null,{...args,eventType:'downloadableFile.created',first:10,jobsFirst:1,after:first.pageInfo.endCursor});
  assert.deepEqual(next.attempts.map(row=>row.run.id),['attempt-5','attempt-4','attempt-2','attempt-1']);
  assert.equal(next.pageInfo.hasNextPage,false);
});

const aliasCases=[
 ['getPipelineSummary(targetId:"file",targetType:"DownloadableFile")','targetId','', 'targetType',''],
 ['getPipelineSummaryPage(targetId:"file",targetType:"DownloadableFile",first:1,jobsFirst:1)','pageInfo','{endCursor hasNextPage}','attempts','{run{id}}'],
 ['getPipelineRunPage(pipelineRunId:"attempt-1",first:1)','run','{id}','jobsPageInfo','{endCursor hasNextPage}'],
 ['getPublicPipelineRun(pipelineRunId:"attempt-1")','id','','status',''],
] as const;
for(const [operation,left,leftSelection,right,rightSelection] of aliasCases)test(`${operation}: owned response aliases preserve independent fields`,async()=>{
 await seed(2,2);const secured=applyMiddleware(schema,sourceIdentity,permissions);
 const run=(fields:string)=>graphql({schema:secured,source:`{result:${operation}{${fields}}}`,contextValue:{driver,req:{headers:{}}}});
 const canonical=await run(`${left}${leftSelection} ${right}${rightSelection}`);assert.equal(canonical.errors,undefined,JSON.stringify(canonical.errors));
 const aliased=await run(`${right}:${left}${leftSelection} ${left}:${right}${rightSelection}`);assert.equal(aliased.errors,undefined,JSON.stringify(aliased.errors));
 const row=JSON.parse(JSON.stringify(canonical.data)).result;
 assert.deepEqual(JSON.parse(JSON.stringify(aliased.data)),{result:{[right]:row[left],[left]:row[right]}});
});
test('public pipeline jobs and page-info aliases preserve nested source values',async()=>{
 await seed(1,2);const secured=applyMiddleware(schema,sourceIdentity,permissions);
 const source='{result:getPipelineRunPage(pipelineRunId:"attempt-1",first:1){run{jobs{pluginId:id id:pluginId}} jobsPageInfo{endCursor:hasNextPage hasNextPage:endCursor}}}';
 const result=await graphql({schema:secured,source,contextValue:{driver,req:{headers:{}}}});assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 const row=JSON.parse(JSON.stringify(result.data)).result;
 assert.deepEqual(row.run.jobs,[{pluginId:'attempt-1-job-1',id:'scanner'}]);assert.equal(row.jobsPageInfo.endCursor,true);assert.equal(typeof row.jobsPageInfo.hasNextPage,'string');
});

test('public diagnostic aliases and fragments retain scalar fields and JSON details',async()=>{
 await seed(1,1);await driver.executeQuery('MATCH(j:PluginRun) SET j.publicDiagnostics=$value',{value:JSON.stringify([{level:'INFO',code:'EXAMPLE_CODE',message:'Visible message',details:{example:1},helpUrl:null}])});
 const source='query{result:getPublicPipelineRun(pipelineRunId:"attempt-1"){jobs{diagnostics{message:code code:message ...Details}}}} fragment Details on PublicPluginDiagnostic{details helpUrl}';
 const result=await graphql({schema:applyMiddleware(schema,sourceIdentity,permissions),source,contextValue:{driver,req:{headers:{}}}});
 assert.equal(result.errors,undefined,JSON.stringify(result.errors));assert.deepEqual(JSON.parse(JSON.stringify(result.data)).result.jobs[0].diagnostics,[{message:'EXAMPLE_CODE',code:'Visible message',details:{example:1},helpUrl:null}]);
 assert.doesNotMatch(JSON.stringify(result.data),/private payload|private config|private message/);
});
test('raw diagnostic leaves complete only when selected and keep alias error paths',async()=>{
 await seed(1,1);await driver.executeQuery('MATCH(j:PluginRun) SET j.publicDiagnostics=$value',{value:JSON.stringify([{level:'INFO',code:'EXAMPLE_CODE',message:{invalid:true},details:null,helpUrl:null}])});
 const secured=applyMiddleware(schema,sourceIdentity,permissions);
 const source='query($skip:Boolean!){result:getPublicPipelineRun(pipelineRunId:"attempt-1"){jobs{diagnostics{code text:message @skip(if:$skip)}}}}';
 const run=(skip:boolean)=>graphql({schema:secured,source,variableValues:{skip},contextValue:{driver,req:{headers:{}}}});
 const skipped=await run(true);assert.equal(skipped.errors,undefined);assert.deepEqual(JSON.parse(JSON.stringify(skipped.data)).result.jobs[0].diagnostics,[{code:'EXAMPLE_CODE'}]);
 const selected=await run(false);assert.match(selected.errors?.[0].message??'',/String cannot represent value/);assert.deepEqual(selected.errors?.[0].path,['result','jobs',0,'diagnostics',0,'text']);
});
test('raw diagnostic container handling preserves malformed and non-object item behavior',async()=>{
 await seed(1,1);const secured=applyMiddleware(schema,sourceIdentity,permissions);
 const run=(fields:string)=>graphql({schema:secured,source:`{result:getPublicPipelineRun(pipelineRunId:"attempt-1"){jobs{${fields}}}}`,contextValue:{driver,req:{headers:{}}}});
 for(const value of ['{','{}','null']){
  await driver.executeQuery('MATCH(j:PluginRun) SET j.publicDiagnostics=$value',{value});
  const result=await run('diagnostics{code}');assert.equal(result.errors,undefined);assert.deepEqual(JSON.parse(JSON.stringify(result.data)).result.jobs[0].diagnostics,[]);
 }
 await driver.executeQuery('MATCH(j:PluginRun) SET j.publicDiagnostics=$value',{value:'[null]'});
 assert.equal((await run('id')).errors,undefined);const selected=await run('diagnostics{code}');assert.ok(selected.errors?.length);assert.deepEqual(selected.errors[0].path,['result','jobs',0,'diagnostics',0]);
});

test('aliased public pipeline roots preserve hidden-target errors and nullable missing runs',async()=>{
 await seed(1,1);const secured=applyMiddleware(schema,sourceIdentity,permissions);
 const run=(operation:string,fields:string)=>graphql({schema:secured,source:`{result:${operation}{${fields}}}`,contextValue:{driver,req:{headers:{}}}});
 for(const operation of ['getPipelineRunPage(pipelineRunId:"missing")','getPublicPipelineRun(pipelineRunId:"missing")']){
  const result=await run(operation,'__typename');assert.equal(result.errors,undefined);assert.deepEqual(JSON.parse(JSON.stringify(result.data)),{result:null});
 }
 await driver.executeQuery('MATCH(d:Discussion) SET d.deleted=true');
 for(const [operation] of aliasCases){const result=await run(operation,'__typename');assert.ok(result.errors?.length,operation);assert.deepEqual(result.errors[0].path,['result']);}
});
