import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { graphql, type GraphQLSchema } from "graphql";
import { applyMiddleware } from "graphql-middleware";
import type { Driver } from "neo4j-driver";
import typeDefs from "../../typeDefs.js";
import getResolvers from "../helpers/getTestResolvers.js";
import permissions from "../../permissions.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { startNeo4j, stopNeo4j, resetDatabase } from "./neo4jHarness.js";

let driver: Driver, schema: GraphQLSchema, secured: GraphQLSchema;
before(async () => {
  driver = await startNeo4j();
  schema = await new Neo4jGraphQL({driver,typeDefs,resolvers:getResolvers(driver).resolvers,
    features:{filters:{String:{MATCHES:true}}}}).getSchema();
  registerGeneratedSchema(driver,schema);
  secured=applyMiddleware(schema,permissions);
},{timeout:240000});
after(async()=>stopNeo4j());
beforeEach(async()=>resetDatabase(driver));
const user={username:"actor",email:null,email_verified:true,data:null};
const execute=(source:string,secure=false,authenticated=true)=>graphql({schema:secure?secured:schema,source,
  contextValue:{driver,req:{headers:{}},user:authenticated?user:undefined,mayAccessSensitiveContent:false}});
const plain=(result:Awaited<ReturnType<typeof execute>>)=>{
  assert.equal(result.errors,undefined,JSON.stringify(result.errors));
  return JSON.parse(JSON.stringify(result.data));
};
async function seed() {
  await driver.executeQuery(`CREATE (u:User {username:'actor',createdAt:datetime()})-[:POSTED_DISCUSSION]->
    (d:Discussion {id:'discussion',title:'Download',deleted:false,hasSensitiveContent:false,createdAt:datetime()})-[:HAS_DOWNLOADABLE_FILE]->
    (:DownloadableFile {id:'file',fileName:'test.zip',kind:'ZIP',priceModel:'FREE',url:'https://example.invalid/test.zip',scanStatus:'SUSPICIOUS',uploadedByUsername:'actor',createdAt:datetime()})
    CREATE (:DiscussionChannel {id:'post',channelUniqueName:'forum',archived:false})-[:POSTED_IN_CHANNEL]->(d)
    CREATE (:PluginPipelineRun {id:'attempt',pipelineId:'pipeline',targetId:'file',targetType:'DownloadableFile',eventType:'downloadableFile.created',scope:'SERVER',status:'SUCCEEDED',trigger:'EVENT',attemptNumber:1,configurationSnapshot:'private configuration',createdAt:datetime('2026-01-01T00:00:00Z'),updatedAt:datetime('2026-01-01T00:00:00Z')})
    CREATE (:PluginRun {id:'job',pluginId:'scanner',version:'1',scope:'SERVER',eventType:'downloadableFile.created',status:'SUCCEEDED',targetId:'file',targetType:'DownloadableFile',payload:'private payload',message:'private message',pipelineId:'pipeline',executionOrder:0,createdAt:datetime('2026-01-01T00:00:00Z'),updatedAt:datetime('2026-01-01T00:00:00Z')})`);
}
const histories=[
  'getPipelineRuns(targetId:"file",targetType:"DownloadableFile")',
  'getPluginRunsForDownloadableFile(downloadableFileId:"file")',
] as const;
for(const field of histories) {
  test(`${field}: real GraphQL serializes empty and populated selected history`,async()=>{
    const source=`{result:${field}{id pluginId version scope channelId eventType status message durationMs targetId targetType payload createdAt updatedAt}}`;
    assert.deepEqual(plain(await execute(source)),{result:[]});
    await seed();
    const row=plain(await execute(source)).result[0];
    assert.equal(row.id,'job');assert.equal(row.durationMs,null);assert.equal(row.channelId,null);
    assert.equal(row.payload,'private payload');assert.equal(row.createdAt,'2026-01-01T00:00:00.000Z');
  });
  test(`${field}: selected generated projection failure propagates even when outer field is omitted`,async()=>{
    await seed();await driver.executeQuery('MATCH(j:PluginRun) REMOVE j.version');
    const result=await execute(`{result:${field}{id}}`);
    assert.ok(result.errors?.some(e=>e.message.includes('PluginRun.version')));assert.equal(result.data,null);
  });
  test(`${field}: permission middleware denies anonymous access`,async()=>{
    await seed();assert.ok((await execute(`{result:${field}{id}}`,true,false)).errors);
  });
}
const publicFields='id pipelineId targetId targetType eventType scope channelId attemptNumber queuedAt createdAt updatedAt jobs { id pluginId pluginName version scope channelId eventType status executionOrder message durationMs skippedReason diagnostics {code level message details helpUrl} queuedAt createdAt updatedAt }';
test('public detail and summary serialize public fields without private history payloads',async()=>{
  await seed();
  const result=plain(await execute(`{detail:getPublicPipelineRun(pipelineRunId:"attempt"){${publicFields}} summary:getPipelineSummary(targetId:"file",targetType:"DownloadableFile"){targetId targetType attempts {${publicFields}}}}`));
  assert.equal(result.detail.id,'attempt');assert.equal(result.detail.jobs[0].pluginName,'scanner');
  assert.equal(result.detail.jobs[0].message,'Plugin completed successfully.');
  assert.deepEqual(result.summary.attempts,[result.detail]);assert.ok(!JSON.stringify(result).includes('private'));
});
test('missing public/internal details remain nullable while hidden public targets retain errors',async()=>{
  assert.deepEqual(plain(await execute('{a:getPublicPipelineRun(pipelineRunId:"missing"){id} b:getInternalPluginPipelineRun(pipelineRunId:"missing"){attempt{id}}}')),{a:null,b:null});
  await seed();await driver.executeQuery('MATCH(d:Discussion) SET d.deleted=true');
  assert.match((await execute('{getPublicPipelineRun(pipelineRunId:"attempt"){id}}')).errors?.[0].message??'',/Pipeline target not found/);
});
test('internal detail retains private selected fields and nested enum serialization',async()=>{
  await seed();const result=plain(await execute('{getInternalPluginPipelineRun(pipelineRunId:"attempt"){attempt{id status trigger configurationSnapshot} jobs{id message payload leaseId}}}'));
  assert.deepEqual(result.getInternalPluginPipelineRun,{attempt:{id:'attempt',status:'SUCCEEDED',trigger:'EVENT',configurationSnapshot:'private configuration'},jobs:[{id:'job',message:'private message',payload:'private payload',leaseId:null}]});
  assert.ok((await execute('{getInternalPluginPipelineRun(pipelineRunId:"attempt"){attempt{id}}}',true,false)).errors);
});
test('public runtime enum errors are retained for malformed job status',async()=>{
  await seed();await driver.executeQuery("MATCH(j:PluginRun) SET j.status='NOT_A_STATUS'");
  const result=await execute('{getPublicPipelineRun(pipelineRunId:"attempt"){id jobs {status}}}');
  assert.ok(result.errors?.some(e=>/PluginRunStatus/.test(e.message)));
});
for(const [name,fields] of [
  ['clearDownloadableFileScan','id fileName scanStatus scanReason scanCheckedAt'],
  ['requestDownloadableFileReview','id fileName scanStatus scanReason scanCheckedAt reviewRequestedAt reviewRequestReason reviewRequestedByUsername'],
] as const){
  const source=`mutation {result:${name}(downloadableFileId:"file",reason:" Reviewed "){${fields}}}`;
  test(`${name}: response serialization preserves writes and selected nullable values`,async()=>{
    await seed();const row=plain(await execute(source)).result;
    assert.equal(row.id,'file');assert.equal(row.fileName,'test.zip');
    if(name==='clearDownloadableFileScan') {assert.equal(row.scanStatus,'CLEAN');assert.match(row.scanReason,/Reviewed/);assert.ok(row.scanCheckedAt);}
    else {assert.equal(row.scanStatus,'SUSPICIOUS');assert.equal(row.scanReason,null);assert.equal(row.reviewRequestReason,'Reviewed');assert.equal(row.reviewRequestedByUsername,'actor');}
    const stored=(await driver.executeQuery('MATCH(f:DownloadableFile) RETURN properties(f) AS f')).records[0].get('f');
    assert.equal(name==='clearDownloadableFileScan'?stored.scanStatus:stored.reviewRequestedByUsername,name==='clearDownloadableFileScan'?'CLEAN':'actor');
  });
  test(`${name}: missing target and anonymous requests retain errors`,async()=>{
    assert.ok((await execute(source)).errors);await seed();assert.ok((await execute(source,true,false)).errors);
  });
  test(`${name}: default projection failure occurs after the committed write`,async()=>{
    await seed();await driver.executeQuery('MATCH(f:DownloadableFile) REMOVE f.createdAt');
    const result=await execute(source);assert.equal(result.data,null);assert.ok(result.errors?.some(e=>e.message.includes('createdAt')));
    const row=(await driver.executeQuery('MATCH(f:DownloadableFile) RETURN properties(f) AS f')).records[0].get('f');
    assert.equal(name==='clearDownloadableFileScan'?row.scanStatus:row.reviewRequestedByUsername,name==='clearDownloadableFileScan'?'CLEAN':'actor');
  });
}
test('secret setter and status query serialize Booleans, nullable timestamps and status strings',async()=>{
  assert.deepEqual(plain(await execute('{getServerPluginSecrets(pluginId:"plugin"){key status lastValidatedAt validationError}}')),{getServerPluginSecrets:[]});
  const set='mutation {setServerPluginSecret(pluginId:"plugin",key:"apiKey",value:"disposable-test-value")}';
  assert.deepEqual(plain(await execute(set)),{setServerPluginSecret:true});assert.deepEqual(plain(await execute(set)),{setServerPluginSecret:true});
  assert.deepEqual(plain(await execute('{getServerPluginSecrets(pluginId:"plugin"){key status lastValidatedAt validationError}}')),{getServerPluginSecrets:[{key:'apiKey',status:'SET_UNTESTED',lastValidatedAt:null,validationError:null}]});
  for (const isValid of [true,false]) {
    await driver.executeQuery("MATCH(s:ServerSecret) SET s.lastValidatedAt=datetime('2026-01-01T00:00:00Z'),s.isValid=$isValid",{isValid});
    const statuses=plain(await execute('{getServerPluginSecrets(pluginId:"plugin"){key status lastValidatedAt validationError}}')).getServerPluginSecrets;
    assert.equal(statuses[0].status,isValid?'VALID':'INVALID');
    assert.equal(statuses[0].lastValidatedAt,'2026-01-01T00:00:00.000Z');
  }
  assert.ok((await execute(set,true,false)).errors);
});
test('trackDownload and support settings return actual Boolean results and preserve repeated updates',async()=>{
  await seed();
  for(let i=0;i<2;i++) assert.deepEqual(plain(await execute('mutation {trackDownload(downloadableFileId:"file",discussionId:"discussion")}')),{trackDownload:true});
  const support='mutation {updateDownloadableFileSupportSettings(downloadableFileId:"file",discussionId:"discussion",input:{attributionOverride:"Author"})}';
  assert.deepEqual(plain(await execute(support)),{updateDownloadableFileSupportSettings:true});
  const row=(await driver.executeQuery('MATCH(f:DownloadableFile) RETURN f.downloadCountTotal AS total,f.downloadCountUnique AS unique,f.attributionOverride AS attribution')).records[0];
  assert.equal(Number(row.get('total')),2);assert.equal(Number(row.get('unique')),1);assert.equal(row.get('attribution'),'Author');
  assert.ok((await execute('mutation {trackDownload(downloadableFileId:"missing",discussionId:"discussion")}')).errors);
  assert.ok((await execute('mutation {updateDownloadableFileSupportSettings(downloadableFileId:"missing",discussionId:"discussion",input:{})}')).errors);
});
