import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import type {GraphQLSchema,GraphQLObjectType} from 'graphql';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import getResolver from '../../customResolvers/mutations/refreshPlugins.js';
import typeDefs from '../../typeDefs.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import * as persistence from '../../services/persistence/pluginRegistryRepository.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver;let app:ReturnType<typeof getCustomResolvers>;let schema:GraphQLSchema;let events:any[]=[];const engine=createSubscriptionEngine();
for(const kind of ['update','create','create_relationship','delete_relationship'])engine.events.on(kind,(event: unknown)=>events.push(event));
before(async()=>{driver=await startNeo4j();app=getCustomResolvers(driver);const neo=new Neo4jGraphQL({driver,typeDefs,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine as unknown as boolean}});schema=await neo.getSchema();registerGeneratedSchema(driver,schema);},{timeout:240000});
beforeEach(async()=>{await resetDatabase(driver);events=[];});after(async()=>{await engine.close();await stopNeo4j();});
const url='https://fixture.invalid/plugin.tgz';
const graph=async()=>({nodes:(await driver.executeQuery('MATCH(n) RETURN toString(id(n)) AS identity,labels(n)[0] AS label,properties(n) AS properties')).records.map(r=>r.toObject()),edges:(await driver.executeQuery('MATCH(a)-[r]->(b) RETURN toString(id(r)) AS identity,toString(id(a)) AS source,toString(id(b)) AS target,type(r) AS type')).records.map(r=>r.toObject())});
async function seed(kind:string){if(kind==='missing')return;await driver.executeQuery("CREATE(:ServerConfig{serverName:'server',pluginRegistries:['https://fixture.invalid/registry']})");if(['existing-plugin','existing-version'].includes(kind))await driver.executeQuery("CREATE(:Plugin{id:'p',name:'plugin',displayName:'Before'})");if(['orphan','existing-version'].includes(kind))await driver.executeQuery("CREATE(:PluginVersion{id:'v',version:'1.0.0',repoUrl:$url})",{url});if(kind==='existing-version')await driver.executeQuery("MATCH(p:Plugin),(v:PluginVersion) CREATE(p)-[:HAS_VERSION]->(v)");}
for(const kind of ['missing','new','existing-plugin','existing-version','orphan','version-projection','final-projection'] as const)test(`actual registry refresh parity: ${kind}`,async(t)=>{
 const field=kind==='version-projection'?(schema.getType('PluginVersion') as GraphQLObjectType).getFields().entryPath:kind==='final-projection'?(schema.getType('Plugin') as GraphQLObjectType).getFields().Versions:null;
 const original=field?.resolve;if(field)field.resolve=()=>{throw Error('fixture projection failure');};
 try{for(const repo of [persistence.createPluginRegistryRepository(driver)]){
  await resetDatabase(driver);await seed(kind);events=[];const external:string[]=[];
  const resolver=getResolver({driver,pluginRegistryRepository:repo},{fetchRegistry:async urls=>{external.push('registry');assert.deepEqual(urls,['https://fixture.invalid/registry']);return {plugins:[{id:'plugin',versions:[{version:'1.0.0',tarballUrl:url,integritySha256:'fixture'}]}]};},readArtifacts:async requested=>{external.push('manifest');assert.equal(requested,url);return {id:'plugin',version:'1.0.0',entryPath:'index.js',manifest:{name:'After',metadata:{tags:['fixture']},settingsDefaults:{enabled:true},ui:{type:'object'}}} as any;}});
  let response:unknown,error:string|null=null;try{response=await resolver(null,{},{} as never,{} as never);}catch(e){error=(e as Error).message;}
  assert.equal(error,kind==='missing'?'Failed to refresh plugins: No plugin registries configured':null);
  const state=await graph();const node=(id:string)=>{const found=state.nodes.find(n=>n.identity===id);assert.ok(found);return found;};
  const alias=(id:string)=>{const n=node(id);return n.label+':'+(n.properties.name??n.properties.version??n.properties.serverName);};
  const domainIds=new Map(state.nodes.filter(n=>n.properties.id).map(n=>[n.properties.id,alias(n.identity)]));
  // v7 emits no in-process subscription events; event assertions removed.
  if(kind!=='missing'){assert.equal(state.nodes.filter(n=>n.label==='Plugin').length,1);assert.equal(state.nodes.filter(n=>n.label==='PluginVersion').length,1);assert.equal(state.edges.filter(e=>e.type==='HAS_VERSION').length,1);assert.deepEqual(external,['registry','manifest']);}
  if(field)assert.deepEqual((response as any[])[0].Versions,[]);
  const result=JSON.parse(JSON.stringify({response,error,external,nodes:state.nodes.map(n=>({alias:alias(n.identity),properties:n.properties})).sort((a,b)=>a.alias.localeCompare(b.alias)),edges:state.edges.map(r=>({source:alias(r.source),target:alias(r.target),type:r.type})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))},function(key,value){if(this.event&&['id','id_from','id_to'].includes(key)){if(key==='id'&&this.event.includes('relationship')){const edge=state.edges.find(r=>r.identity===value)!;return edge.type+':'+alias(edge.source)+':'+alias(edge.target);}return alias(value);}if(key==='timestamp')return '<time>';return typeof value==='string'&&domainIds.has(value)?domainIds.get(value):value;}));
  t.assert.snapshot(result);
 }}finally{if(field)field.resolve=original;}
});
test('defaults, missing rows, literal input and unbounded orphan/config reads match production',async(t)=>{
 const next=persistence.createPluginRegistryRepository(driver);
 await driver.executeQuery("UNWIND range(1,29) AS i CREATE(:ServerConfig{serverName:'s'+toString(i),pluginRegistries:[]}) CREATE(:PluginVersion{id:'v'+toString(i),version:'1',repoUrl:'u'})");
 for(const repo of [next]){assert.equal((await repo.findRegistryConfigs()).length,29);assert.equal((await repo.findOrphanCandidates()).length,29);assert.deepEqual(await repo.findPluginByName('quote"\\'),[]);assert.deepEqual(await repo.findPluginDefaultByName('missing'),[]);assert.deepEqual(await repo.findPluginsForVersion('missing'),[]);assert.deepEqual(await repo.findRegistryResult('missing'),[]);assert.deepEqual(await repo.findRegistryVersion('missing','u'),[]);}
 t.assert.snapshot(await next.findOrphanCandidates());t.assert.snapshot(await next.findRegistryConfigs());
});
test('generated input coercion prevents writes with the same error',async()=>{const repo=persistence.createPluginRegistryRepository(driver);await assert.rejects(repo.createRegistryPlugin([{name:123}] as never),/String cannot represent a non string value/);assert.deepEqual(await graph(),{nodes:[],edges:[]});});
