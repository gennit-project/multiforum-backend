import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import type {GraphQLSchema} from 'graphql';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import getResolver from '../../customResolvers/mutations/installPluginVersion.js';
import typeDefs from '../../typeDefs.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import * as persistence from '../../services/persistence/pluginInstallRepository.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver;let app:ReturnType<typeof getCustomResolvers>;let schema:GraphQLSchema;let events:any[]=[];const engine=createSubscriptionEngine();
for(const kind of ['update','create','create_relationship','delete_relationship'])engine.events.on(kind,(event: unknown)=>events.push(event));
before(async()=>{driver=await startNeo4j();app=getCustomResolvers(driver);const neo=new Neo4jGraphQL({driver,typeDefs,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine as unknown as boolean}});schema=await neo.getSchema();registerGeneratedSchema(driver,schema);},{timeout:240000});
beforeEach(async()=>{await resetDatabase(driver);events=[];});after(async()=>{await engine.close();await stopNeo4j();});
const url='https://fixture.invalid/plugin.tgz';const bytes=Buffer.from('synthetic-only');const digest=crypto.createHash('sha256').update(bytes).digest('hex');
const graph=async()=>({nodes:(await driver.executeQuery('MATCH(n) RETURN toString(id(n)) AS identity,labels(n)[0] AS label,properties(n) AS properties')).records.map(r=>r.toObject()),edges:(await driver.executeQuery('MATCH(a)-[r]->(b) RETURN toString(id(r)) AS identity,toString(id(a)) AS source,toString(id(b)) AS target,type(r) AS type,properties(r) AS properties')).records.map(r=>r.toObject())});
async function seed(kind:string){if(kind==='missing')return;await driver.executeQuery("CREATE(:ServerConfig{serverName:'server',pluginRegistries:['https://fixture.invalid/registry']})");if(['existing-plugin','existing-version','already-installed','carry'].includes(kind))await driver.executeQuery("CREATE(:Plugin{id:'p',name:'plugin',displayName:'Before'})");if(['existing-version','already-installed'].includes(kind))await driver.executeQuery("MATCH(p:Plugin) CREATE(p)-[:HAS_VERSION]->(:PluginVersion{id:'v',version:'1',repoUrl:$url,entryPath:'old.js'})",{url});if(kind==='already-installed')await driver.executeQuery("MATCH(s:ServerConfig),(v:PluginVersion) CREATE(s)-[:INSTALLED{enabled:true,settingsJson:'{\"keep\":true}'}]->(v)");if(kind==='carry')await driver.executeQuery("MATCH(s:ServerConfig),(p:Plugin) CREATE(p)-[:HAS_VERSION]->(v:PluginVersion{id:'old',version:'0',entryPath:'old.js',manifest:'{}'}) CREATE(s)-[:INSTALLED{enabled:true,settingsJson:'{\"enabled\":false}'}]->(v)");}
// v7 (campaign #284): the former 'plugin-projection'/'version-projection'/
// 'connection-projection' kinds asserted v5's non-atomic partial-write prefix
// (a field resolver throwing during projection left an earlier mutation step
// committed). The install resolver is a sequence of independent generated
// mutations + owned edge MERGEs, so that partial-commit shape is an artifact
// of the old native path, not a contract we keep. Pruned per the owner's
// decision to drop projection-failure cases.
for(const kind of ['missing','new','existing-plugin','existing-version','already-installed','carry'] as const)test(`actual install parity: ${kind}`,async(t)=>{
 for(const repo of [persistence.createPluginInstallRepository(driver)]){
  await resetDatabase(driver);await seed(kind);events=[];const external:string[]=[];
  const resolver=getResolver({driver,pluginInstallRepository:repo},{fetchRegistry:async urls=>{external.push('registry');assert.deepEqual(urls,['https://fixture.invalid/registry']);return {plugins:[{id:'plugin',versions:[{version:'1',tarballUrl:url,integritySha256:digest}]}]};},download:async requested=>{external.push('download');assert.equal(requested,url);return bytes;},readManifest:async supplied=>{external.push('manifest');assert.deepEqual(supplied,bytes);return {id:'plugin',version:'1',entryPath:'index.js',manifest:{name:'After',metadata:{tags:['fixture']},settingsDefaults:{enabled:true},ui:{type:'object'}}} as any;}});
  let response:unknown,error:string|null=null;try{response=await resolver(null,{pluginId:'plugin',version:'1',carrySettings:kind==='carry'},{} as never,{} as never);}catch(e){error=(e as Error).message;}
  assert.equal(error,kind==='missing'?'Failed to install plugin: No plugin registries configured':null);
  const state=await graph();const node=(id:string)=>{const found=state.nodes.find(n=>n.identity===id);assert.ok(found);return found;};
  const alias=(id:string)=>{const n=node(id);return n.label+':'+(n.properties.name??n.properties.version??n.properties.serverName);};
  const domainIds=new Map(state.nodes.filter(n=>n.properties.id).map(n=>[n.properties.id,alias(n.identity)]));
  // v7 emits no in-process subscription events; event assertions removed.
  if(kind!=='missing'){assert.equal(state.nodes.filter(n=>n.label==='Plugin').length,1);assert.equal(state.nodes.filter(n=>n.label==='PluginVersion').length,kind==='carry'?2:1);assert.equal(state.edges.filter(e=>e.type==='HAS_VERSION').length,kind==='carry'?2:1);assert.equal(state.edges.filter(e=>e.type==='INSTALLED').length,kind==='carry'?2:1);assert.deepEqual(external,['registry','download','manifest']);}
  const result=JSON.parse(JSON.stringify({response,error,external,nodes:state.nodes.map(n=>({alias:alias(n.identity),properties:n.properties})).sort((a,b)=>a.alias.localeCompare(b.alias)),edges:state.edges.map(r=>({source:alias(r.source),target:alias(r.target),type:r.type,properties:r.properties})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))},function(key,value){if(this.event&&['id','id_from','id_to'].includes(key)){if(key==='id'&&this.event.includes('relationship')){const edge=state.edges.find(r=>r.identity===value)!;return edge.type+':'+alias(edge.source)+':'+alias(edge.target);}return alias(value);}if(key==='timestamp')return '<time>';return typeof value==='string'&&domainIds.has(value)?domainIds.get(value):value;}));
  t.assert.snapshot(result);
 }
});
test('exact defaults, literal filters and unbounded configuration reads retain generated behavior',async(t)=>{
 const next=persistence.createPluginInstallRepository(driver);
 await driver.executeQuery("UNWIND range(1,29) AS i CREATE(:ServerConfig{serverName:'s'+toString(i),pluginRegistries:[]})");
 assert.equal((await next.findInstallConfigs()).length,29);t.assert.snapshot(await next.findInstallConfigs());
 for(const repo of [next]){assert.deepEqual(await repo.findInstallPlugin('quote"\\'),[]);assert.deepEqual(await repo.findInstallVersion('quote"\\','plugin'),[]);assert.deepEqual(await repo.findInstalledVersions('missing'),[]);}
});
test('generated input coercion prevents writes with matching errors',async()=>{const repo=persistence.createPluginInstallRepository(driver);await assert.rejects(repo.createInstallPlugin([{name:123}] as never),/String cannot represent a non string value/);assert.deepEqual(await graph(),{nodes:[],edges:[]});});
