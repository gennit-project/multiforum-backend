import assert from 'node:assert/strict';
import {before,after,beforeEach,afterEach,test} from 'node:test';
import crypto from 'node:crypto';
import {Neo4jGraphQL} from '@neo4j/graphql';
import {graphql,type GraphQLSchema} from 'graphql';
import type {Driver} from 'neo4j-driver';
import typeDefs from '../../typeDefs.js';
import getResolvers from '../helpers/getTestResolvers.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createPluginRegistryRepository} from '../../services/persistence/pluginRegistryRepository.js';
import install from '../../customResolvers/mutations/installPluginVersion.js';
import refresh from '../../customResolvers/mutations/refreshPlugins.js';
import {denyImageExternalIo} from '../denyImageExternalIo.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver,schema:GraphQLSchema,guard:ReturnType<typeof denyImageExternalIo>;
let failure:'none'|'registry'|'refetch'|'artifact'='none';
const bytes=Buffer.from('fixture tarball bytes');
const manifest={id:'fixture',version:'1.0.0',name:'Fixture',metadata:{tags:['safe']}};
const registry={plugins:[{id:'fixture',versions:[{version:'1.0.0',tarballUrl:'https://example.test/plugin.tgz',integritySha256:crypto.createHash('sha256').update(bytes).digest('hex')}]}]};
const fetchRegistry=async()=>{if(failure==='registry')throw new Error('injected registry failure');return registry;};
const artifacts=async()=>{if(failure==='artifact')throw new Error('injected artifact failure');return {id:'fixture',version:'1.0.0',entryPath:'index.js',manifest};};
before(async()=>{
 driver=await startNeo4j();const app=getResolvers(driver);const repository=createPluginRegistryRepository(driver);
 app.resolvers.Mutation.installPluginVersion=install({driver},{fetchRegistry,download:async()=>bytes,readManifest:artifacts});
 app.resolvers.Mutation.refreshPlugins=refresh({driver,pluginRegistryRepository:{...repository,findRegistryResult:async id=>{if(failure==='refetch')throw new Error('injected refetch failure');return repository.findRegistryResult(id);}}},{fetchRegistry,readArtifacts:artifacts});
 schema=await new Neo4jGraphQL({driver,typeDefs,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}}}}).getSchema();registerGeneratedSchema(driver,schema);guard=denyImageExternalIo();
},{timeout:240000});
afterEach(()=>guard?.assertUnused());
after(async()=>{guard?.restore();await stopNeo4j();});
beforeEach(async()=>{failure='none';await resetDatabase(driver);await driver.executeQuery("CREATE(:ServerConfig {serverName:'fixture',pluginRegistries:['https://example.test/registry']})");});
const exec=(source:string)=>graphql({schema,source,contextValue:{driver}});
function data(result:Awaited<ReturnType<typeof exec>>){assert.equal(result.errors,undefined,JSON.stringify(result.errors));return JSON.parse(JSON.stringify(result.data));}
const installSource='mutation{result:installPluginVersion(pluginId:"fixture",version:"1.0.0"){plugin{id name} version scope enabled settingsJson carryOverReport}}';
const refreshSource='mutation{result:refreshPlugins{id name Versions{id version}}}';
test('install serializes selected response, persists installation, and repeat retains one edge',async()=>{
 const first=data(await exec(installSource)).result;assert.equal(first.plugin.name,'fixture');assert.equal(typeof first.plugin.id,'string');assert.deepEqual({...first,plugin:null},{plugin:null,version:'1.0.0',scope:'SERVER',enabled:false,settingsJson:null,carryOverReport:null});
 assert.deepEqual(data(await exec(installSource)).result,first);
 assert.equal(Number((await driver.executeQuery('MATCH(:ServerConfig)-[r:INSTALLED]->(:PluginVersion) RETURN count(r) AS n')).records[0].get('n')),1);
});
test('install registry rejection and missing configured registry complete as errors',async()=>{
 failure='registry';assert.match((await exec(installSource)).errors?.[0].message??'',/Failed to install plugin: injected registry failure/);
 await driver.executeQuery('MATCH(c:ServerConfig) SET c.pluginRegistries=[]');assert.match((await exec(installSource)).errors?.[0].message??'',/No plugin registries configured/);
});
test('refresh serializes identities and versions on create and update',async()=>{
 const first=data(await exec(refreshSource)).result;assert.equal(first.length,1);assert.equal(first[0].name,'fixture');assert.equal(first[0].Versions[0].version,'1.0.0');assert.deepEqual(data(await exec(refreshSource)).result,first);
});
test('refresh refetch failure preserves id/name fallback and empty Versions',async()=>{
 data(await exec(refreshSource));failure='refetch';const result=data(await exec(refreshSource)).result;assert.equal(result.length,1);assert.equal(result[0].name,'fixture');assert.equal(typeof result[0].id,'string');assert.deepEqual(result[0].Versions,[]);
});
test('refresh artifact failure skips version; registry failure propagates',async()=>{
 failure='artifact';assert.deepEqual(data(await exec(refreshSource)),{result:[]});failure='registry';assert.match((await exec(refreshSource)).errors?.[0].message??'',/Failed to refresh plugins: injected registry failure/);
});
test('enable and disable serialize metadata and persist the edge flag',async()=>{
 data(await exec(installSource));
 for(const enabled of [true,false]){
 const result=data(await exec(`mutation{result:enableServerPlugin(pluginId:"fixture",version:"1.0.0",enabled:${enabled}){plugin{id name displayName description authorName authorUrl homepage license tags metadata} version scope enabled settingsJson manifest settingsDefaults uiSchema documentationPath readmeMarkdown registryUrl releaseNotesUrl sourceRepoUrl sourceCommit minServerVersion apiVersion}}`)).result;
 assert.equal(result.enabled,enabled);assert.equal(result.plugin.name,'fixture');assert.equal(result.plugin.description,null);assert.deepEqual(result.plugin.tags,['safe']);assert.equal(result.documentationPath,null);
 assert.equal((await driver.executeQuery('MATCH(:ServerConfig)-[r:INSTALLED]->(:PluginVersion) RETURN r.enabled AS enabled')).records[0].get('enabled'),enabled);
 }
});
test('enable missing plugin, version and installation retain wrapped failure',async()=>{
 const source='mutation{result:enableServerPlugin(pluginId:"fixture",version:"1.0.0",enabled:true){version}}';
 assert.match((await exec(source)).errors?.[0].message??'',/Failed to enable plugin: Plugin fixture not found/);
 data(await exec(installSource));await driver.executeQuery('MATCH(:ServerConfig)-[r:INSTALLED]->() DELETE r');assert.match((await exec(source)).errors?.[0].message??'',/not installed/);
 assert.match((await exec(source.replace('1.0.0','missing'))).errors?.[0].message??'',/version missing not found/);
});
