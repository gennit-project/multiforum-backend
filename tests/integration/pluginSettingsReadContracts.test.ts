import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { graphql, type GraphQLSchema } from "graphql";
import { applyMiddleware } from "graphql-middleware";
import type { Driver } from "neo4j-driver";
import typeDefs from "../../typeDefs.js";
import compose from "../helpers/getTestResolvers.js";
import permissions from "../../permissions.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { startNeo4j, stopNeo4j, resetDatabase } from "./neo4jHarness.js";
let driver: Driver, schema: GraphQLSchema, protectedSchema: GraphQLSchema;
before(async () => {
  driver = await startNeo4j();
  schema = await new Neo4jGraphQL({driver,typeDefs,resolvers:compose(driver).resolvers}).getSchema();
  registerGeneratedSchema(driver,schema);
  protectedSchema=applyMiddleware(schema,permissions);
},{timeout:240000});
after(async()=>stopNeo4j());
beforeEach(async()=>resetDatabase(driver));
async function seed(orphan=false) {
  await driver.executeQuery(`CREATE (v:PluginVersion {id:'v',version:'1',repoUrl:'repo',entryPath:'index.js',manifest:$manifest}),
    (s:ServerConfig {serverName:'server'})-[:INSTALLED {enabled:true,settingsJson:'{}'}]->(v)`, {manifest:JSON.stringify({ui:{forms:{server:[{fields:[{key:'required',required:true,type:'text'}]}],custom:[{fields:[{key:'custom',type:'text'}]}]}}})});
  if(!orphan) await driver.executeQuery("MATCH(v:PluginVersion) CREATE (:Plugin {id:'p',name:'plugin'})-[:HAS_VERSION]->(v)");
}
const installedFields="version scope enabled documentationPath readmeMarkdown registryUrl releaseNotesUrl sourceRepoUrl sourceCommit minServerVersion apiVersion hasUpdate latestVersion availableVersions plugin{displayName description authorName authorUrl homepage license tags}";
const statusFields="isFullyConfigured fields{key label scope kind required isSet isValid message}";
const exec=(source:string,secure=false)=>graphql({schema:secure?protectedSchema:schema,source,contextValue:{driver,req:{headers:{}}}});
const plain=(result:Awaited<ReturnType<typeof exec>>)=>{assert.equal(result.errors,undefined);return JSON.parse(JSON.stringify(result.data));};
test("empty installations serialize as empty list",async()=>{assert.deepEqual(plain(await exec(`{getInstalledPlugins{${installedFields}}}`)),{getInstalledPlugins:[]});});
test("installed read serializes selected scalar/null/list defaults and decoded JSON",async()=>{
  await seed(); const row=plain(await exec(`{getInstalledPlugins{${installedFields} settingsJson manifest}}`)).getInstalledPlugins[0];
  assert.equal(row.version,'1');assert.equal(row.scope,'SERVER');assert.equal(row.enabled,true);assert.equal(row.hasUpdate,false);
  assert.deepEqual(row.availableVersions,[]);assert.equal(row.latestVersion,null);assert.deepEqual(row.settingsJson,{});
  for(const key of ['documentationPath','readmeMarkdown','registryUrl','releaseNotesUrl','sourceRepoUrl','sourceCommit','minServerVersion','apiVersion'])assert.equal(row[key],null);
  assert.deepEqual(row.plugin,{displayName:null,description:null,authorName:null,authorUrl:null,homepage:null,license:null,tags:[]});
});
test("orphan storage Plugin link preserves safe selections and lazy non-null identity failure",async()=>{
  await seed(true);assert.equal(plain(await exec(`{getInstalledPlugins{${installedFields}}}`)).getInstalledPlugins[0].version,'1');
  const result=await exec('{getInstalledPlugins{plugin{id name}}}');assert.match(result.errors?.[0].message??'',/Cannot return null for non-nullable field Plugin.id/);
});
test("configuration status serializes required fields and nullable/custom scope unchanged",async()=>{
  await seed();
  for(const scope of ['',',scope:null',',scope:""']){
    const status=plain(await exec(`{getPluginConfigStatus(pluginId:"plugin",version:"1"${scope}){${statusFields}}}`)).getPluginConfigStatus;
    assert.equal(status.isFullyConfigured,false);assert.deepEqual(status.fields,[{key:'required',label:'required',scope:'server',kind:'SETTING',required:true,isSet:false,isValid:false,message:'Required setting is not set'}]);
  }
  const custom=plain(await exec(`{getPluginConfigStatus(pluginId:"plugin",version:"1",scope:"custom"){${statusFields}}}`)).getPluginConfigStatus;
  assert.equal(custom.isFullyConfigured,true);assert.equal(custom.fields[0].scope,'custom');
});
test("missing version/installation and malformed installed JSON retain wrapped errors",async()=>{
  assert.match((await exec(`{getPluginConfigStatus(pluginId:"missing",version:"1"){${statusFields}}}`)).errors?.[0].message??'',/Failed to get plugin config status:.*not found/);
  await seed();await driver.executeQuery('MATCH()-[r:INSTALLED]->() DELETE r');
  assert.match((await exec(`{getPluginConfigStatus(pluginId:"plugin",version:"1"){${statusFields}}}`)).errors?.[0].message??'',/not installed/);
  await driver.executeQuery("MATCH(s:ServerConfig),(v:PluginVersion) CREATE(s)-[:INSTALLED {enabled:true,settingsJson:'{bad'}]->(v)");
  assert.match((await exec(`{getInstalledPlugins{${installedFields}}}`)).errors?.[0].message??'',/Failed to get installed plugins:/);
});
test("malformed selected storage fields retain generated projection errors",async()=>{
  await seed();await driver.executeQuery('MATCH(v:PluginVersion) REMOVE v.version');
  assert.match((await exec(`{getInstalledPlugins{${installedFields}}}`)).errors?.[0].message??'',/Failed to get installed plugins:.*PluginVersion.version/);
});
test("actual middleware preserves public installed-list read and protected config status",async()=>{
  await seed();assert.deepEqual(plain(await exec(`{getInstalledPlugins{version}}`,true)),{getInstalledPlugins:[{version:"1"}]});
  assert.ok((await exec(`{getPluginConfigStatus(pluginId:"plugin",version:"1"){${statusFields}}}`,true)).errors);
});
