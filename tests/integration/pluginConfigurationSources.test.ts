import assert from 'node:assert/strict';
import {after,before,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import {graphql,type GraphQLSchema} from 'graphql';
import {applyMiddleware} from 'graphql-middleware';
import type {Driver} from 'neo4j-driver';
import typeDefs from '../../typeDefs.js';
import getResolvers from '../helpers/getTestResolvers.js';
import permissions from '../../permissions.js';
import sourceIdentity from '../../middleware/userChildIdentityMiddleware.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver,schema:GraphQLSchema;const previousConfig=process.env.SERVER_CONFIG_NAME;
before(async()=>{driver=await startNeo4j();process.env.SERVER_CONFIG_NAME='plugin-source-fixture';const raw=await new Neo4jGraphQL({driver,typeDefs,resolvers:getResolvers(driver).resolvers}).getSchema();registerGeneratedSchema(driver,raw);schema=applyMiddleware(raw,sourceIdentity,permissions);},{timeout:240000});
after(async()=>{await stopNeo4j();if(previousConfig===undefined)delete process.env.SERVER_CONFIG_NAME;else process.env.SERVER_CONFIG_NAME=previousConfig;});
beforeEach(async()=>{
 await resetDatabase(driver);
 await driver.executeQuery(`CREATE(s:ServerConfig{serverName:'plugin-source-fixture',pluginRegistries:[],pluginPipelines:$pipeline}),
 (s)-[:HAS_DEFAULT_SERVER_ROLE]->(:ServerRole{canManagePlugins:false}),
 (s)-[:HAS_DEFAULT_ADMIN_ROLE]->(:ServerRole{canManagePlugins:true}),
 (:User{username:'admin'})-[:ADMIN_OF_SERVER]->(s),(:User{username:'ordinary'}),
 (p:Plugin{id:'plugin-node',name:'scanner',displayName:'Scanner',tags:[]}),
 (v:PluginVersion{id:'version',version:'1.0.0',repoUrl:'fixture-only',entryPath:'index.js',manifest:$manifest}),
 (p)-[:HAS_VERSION]->(v),(s)-[:INSTALLED{enabled:true,settingsJson:'{}'}]->(v),
 (:ServerSecret{pluginId:'scanner',key:'API_KEY',ciphertext:'synthetic-only',isValid:true,lastValidatedAt:datetime('2026-01-01')}),
 (d:Discussion{id:'discussion',deleted:false})-[:HAS_DOWNLOADABLE_FILE]->(:DownloadableFile{id:'file',createdAt:datetime('2026-01-01')}),
 (:DiscussionChannel{id:'post',channelUniqueName:'forum',archived:false})-[:POSTED_IN_CHANNEL]->(d)`,{
 pipeline:JSON.stringify([{event:'downloadableFile.created',steps:[{pluginId:'scanner'}]}]),
 manifest:JSON.stringify({events:['downloadableFile.created'],secrets:[{key:'API_KEY',scope:'server',required:true}]}),
 });
});
const desired={apiVersion:'multiforum.gennit.dev/v1alpha1',plugins:[]};
const execute=(source:string,username:string|null='admin',manifest:unknown=desired,variables:Record<string,unknown>={})=>graphql({schema,source,variableValues:{manifest,...variables},contextValue:{driver,req:{headers:{},body:{query:source}},user:username?{username,email:null,email_verified:true,data:{}}:undefined,mayAccessSensitiveContent:false}});
function data(result:Awaited<ReturnType<typeof execute>>){assert.equal(result.errors,undefined,JSON.stringify(result.errors));assert.doesNotMatch(JSON.stringify(result.data),/synthetic-only|ciphertext/);return JSON.parse(JSON.stringify(result.data)).result;}
const cases=[
 ['query','getInstalledPlugins','scope','','version',''],
 ['query','getServerPluginSecrets(pluginId:"scanner")','key','','status',''],
 ['query','getPluginConfigStatus(pluginId:"scanner",version:"1.0.0")','isFullyConfigured','','fields','{key kind}'],
 ['query','getApplicablePluginPipeline(downloadableFileId:"file")','targetId','','targetType',''],
 ['query','previewPluginConfigurationReconciliation(manifest:$manifest)','apiVersion','','inSync',''],
 ['mutation','applyPluginConfiguration(manifest:$manifest)','status','','message',''],
] as const;
for(const [kind,operation,left,leftSelection,right,rightSelection] of cases)test(`${operation}: owned root aliases preserve selected values`,async()=>{
 const declaration=operation.includes('$manifest')?'($manifest:PluginConfigurationDesiredStateInput!)':'';
 const run=(fields:string)=>execute(`${kind}${declaration}{result:${operation}{${fields}}}`);
 const canonical=data(await run(`${left}${leftSelection} ${right}${rightSelection}`));
 const aliased=data(await run(`${right}:${left}${leftSelection} ${left}:${right}${rightSelection}`));
 const swap=(row:Record<string,unknown>)=>({[right]:row[left],[left]:row[right]});
 assert.deepEqual(aliased,Array.isArray(canonical)?canonical.map(swap):swap(canonical));
});
test('installed plugin and config-field child aliases retain independent fields',async()=>{
 assert.deepEqual(data(await execute('{result:getInstalledPlugins{plugin{id:name name:id}}}')),[{plugin:{id:'scanner',name:'plugin-node'}}]);
 assert.deepEqual(data(await execute('{result:getPluginConfigStatus(pluginId:"scanner",version:"1.0.0"){fields{kind:key key:kind}}}')),{fields:[{kind:'API_KEY',key:'SECRET'}]});
});
test('applicable job aliases retain computed plan fields',async()=>{
 const result=data(await execute('{result:getApplicablePluginPipeline(downloadableFileId:"file"){expectedJobs{pluginId:pluginName pluginName:pluginId}}}'));
 assert.deepEqual(result.expectedJobs,[{pluginId:'Scanner',pluginName:'scanner'}]);
});
test('reconciliation change aliases preserve explicit change fields',async()=>{
 const manifest={...desired,plugins:[{pluginId:'scanner',version:'1.0.0',enabled:false}]};
 const run=(fields:string)=>execute(`query($manifest:PluginConfigurationDesiredStateInput!){result:previewPluginConfigurationReconciliation(manifest:$manifest){changes{${fields}}}}`,'admin',manifest);
 const canonical=data(await run('kind path'));assert.ok(canonical.changes.length);
 assert.deepEqual(data(await run('path:kind kind:path')).changes,canonical.changes.map((row:{kind:string;path:string})=>({path:row.kind,kind:row.path})));
});

test('configuration source adapters preserve existing public metadata and protected operations',async()=>{
 for(const [kind,operation,left,leftSelection] of cases){
  const declaration=operation.includes('$manifest')?'($manifest:PluginConfigurationDesiredStateInput!)':'';
  const source=`${kind}${declaration}{result:${operation}{${left}${leftSelection}}}`;
  const protectedOperation=operation.startsWith('getPluginConfigStatus')||operation.startsWith('previewPluginConfiguration')||operation.startsWith('applyPluginConfiguration');
  for(const username of [null,'ordinary']){
   const result=await execute(source,username);
   if(protectedOperation){assert.ok(result.errors?.length,operation);assert.equal(result.data,null);}else data(result);
  }
 }
});
test('applicability aliases preserve visibility checks for hidden targets',async()=>{
 const source='{result:getApplicablePluginPipeline(downloadableFileId:"file"){targetType:targetId targetId:targetType}}';
 assert.deepEqual(data(await execute(source,null)),{targetType:'file',targetId:'DownloadableFile'});
 await driver.executeQuery('MATCH(dc:DiscussionChannel) SET dc.archived=true');
 const denied=await execute(source,null);assert.ok(denied.errors?.length);assert.deepEqual(denied.errors[0].path,['result']);
});
test('configuration fragments and skipped fields retain nullable values',async()=>{
 const source='query($skip:Boolean!){result:getInstalledPlugins{...Metadata omitted:plugin @skip(if:$skip){id}}} fragment Metadata on InstalledPlugin{scope:version version:scope documentationPath plugin{id:name name:id}}';
 assert.deepEqual(data(await execute(source,'admin',desired,{skip:true})),[{scope:'1.0.0',version:'SERVER',documentationPath:null,plugin:{id:'scanner',name:'plugin-node'}}]);
 await driver.executeQuery("MATCH(v:PluginVersion) SET v.manifest='{'");
 const malformed=await execute('{result:getInstalledPlugins{version}}');assert.ok(malformed.errors?.length);assert.match(malformed.errors[0].message,/Failed to get installed plugins/);
});
test('configuration apply aliases retain written outcome and both reconciliation plans',async()=>{
 const manifest={...desired,plugins:[{pluginId:'scanner',version:'1.0.0',enabled:false}]};
 const run=(fields:string)=>execute(`mutation($manifest:PluginConfigurationDesiredStateInput!){result:applyPluginConfiguration(manifest:$manifest){${fields}}}`,'admin',manifest);
 const canonical=data(await run('status planBefore{inSync} planAfter{inSync} operations{kind status path message}'));
 assert.equal(canonical.status,'SUCCEEDED');assert.ok(canonical.operations.length);
 await driver.executeQuery('MATCH()-[r:INSTALLED]->() SET r.enabled=true');
 const aliased=data(await run('status planAfter:planBefore{inSync} planBefore:planAfter{inSync} operations{status:kind kind:status path message}'));
 assert.deepEqual(aliased,{status:canonical.status,planAfter:canonical.planBefore,planBefore:canonical.planAfter,operations:canonical.operations.map((row:{kind:string;status:string;path:string;message:string})=>({status:row.kind,kind:row.status,path:row.path,message:row.message}))});
 assert.equal((await driver.executeQuery('MATCH()-[r:INSTALLED]->() RETURN r.enabled AS enabled')).records[0].get('enabled'),false);
});
