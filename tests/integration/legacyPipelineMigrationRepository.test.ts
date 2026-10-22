import typeDefs from '../../typeDefs.js';
import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {parse,print} from 'graphql';
import type {Driver} from 'neo4j-driver';
import {createOgmPersistence} from '../../services/persistence/ogm.js';
import { initializeLegacyPipelineMigration, LEGACY_PIPELINE_CONFIG_SELECTION, type LegacyPipelineMigrationRepository } from '../../services/persistence/legacyPipelineMigrationRepository.js';
import {migrateLegacyPipelineConfigurations} from '../../services/plugin/migrateLegacyPipelineConfigurations.js';
import {materializeLegacyDownloadPipelines} from '../../services/plugin/legacyPipelineMigration.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
const originalTypeDefs=print(typeDefs);
let driver:Driver,old:LegacyPipelineMigrationRepository,next:LegacyPipelineMigrationRepository;let model:import('../../ogm_types.js').ServerConfigModel;
before(async()=>{driver=await startNeo4j();const {ogm}=createOgmPersistence(driver);await ogm.init();model=ogm.model('ServerConfig');old={findConfigurations:()=>model.find({selectionSet:LEGACY_PIPELINE_CONFIG_SELECTION}),saveConfiguration:async(serverName,pluginPipelines)=>{await model.update({where:{serverName},update:{pluginPipelines}});}};next=await initializeLegacyPipelineMigration(driver);assert.equal(print(typeDefs),originalTypeDefs);},{timeout:240000});
beforeEach(async()=>{await resetDatabase(driver);});after(async()=>{await stopNeo4j();});
const stored=async()=>(await driver.executeQuery('MATCH(s:ServerConfig) RETURN s.serverName AS name,s.pluginPipelines AS pipelines ORDER BY name')).records.map(r=>r.toObject());
async function seed(){await driver.executeQuery("CREATE(s:ServerConfig{serverName:'first',pluginPipelines:'[]'}),(:ServerConfig{serverName:'later',pluginPipelines:'[]'}),(p:Plugin{id:'p',name:'scanner'}),(v:PluginVersion{id:'v',version:'1.0.0',repoUrl:'https://fixture.invalid/plugin',entryPath:'index.js',manifest:$manifest}) CREATE(p)-[:HAS_VERSION]->(v) CREATE(s)-[:INSTALLED{enabled:true,settingsJson:'{}'}]->(v)",{manifest:JSON.stringify({events:['downloadableFile.created']})});}
const materialize:typeof materializeLegacyDownloadPipelines=input=>materializeLegacyDownloadPipelines({...input,effectiveAt:'2026-01-01T00:00:00.000Z',createPolicyId:()=> 'fixture-policy'});
test('standalone CLI schema preserves exact default response and unbounded nested configuration reads',async()=>{
 await driver.executeQuery("UNWIND range(1,29) AS i CREATE(:ServerConfig{serverName:'server'+toString(i),pluginPipelines:'[]'})");
 await driver.executeQuery("MATCH(s:ServerConfig{serverName:'server1'}) UNWIND range(1,29) AS i CREATE(p:Plugin{id:'p'+toString(i),name:'plugin'+toString(i)}) CREATE(v:PluginVersion{id:'v'+toString(i),version:toString(i),repoUrl:'https://fixture.invalid/plugin',entryPath:'index.js'}) CREATE(p)-[:HAS_VERSION]->(v) CREATE(s)-[:INSTALLED{enabled:true,settingsJson:'{}'}]->(v)");
 const baseline=await old.findConfigurations();assert.equal(baseline.length,29);assert.deepEqual(await next.findConfigurations(),baseline);assert.equal(baseline.find(s=>s.serverName==='server1')?.InstalledVersionsConnection.edges.length,29);
});
test('CLI materialization retains skip behavior, exact writes and logging with standalone schemas',async()=>{
 await seed();const baselineRows=await old.findConfigurations();assert.deepEqual(await next.findConfigurations(),baselineRows);let expected:unknown;
 for(const repo of [old,next]){await driver.executeQuery("MATCH(s:ServerConfig) SET s.pluginPipelines='[]'");const logs:string[]=[];await migrateLegacyPipelineConfigurations(repo,line=>logs.push(line),materialize);const value={logs,state:await stored()};assert.equal(logs.length,1);assert.equal(JSON.parse(value.state.find(s=>s.name==='first')!.pipelines).length,1);assert.equal(value.state.find(s=>s.name==='later')!.pipelines,'[]');if(expected)assert.deepEqual(value,expected);else expected=value;}
});
for(const field of ['enableDownloads','rankingSettingsJson'])test(`standalone ${field} projection failure keeps committed write and prevents later saves/logs`,async()=>{
 await seed();await driver.executeQuery("MATCH(s:ServerConfig{serverName:'first'}),(v:PluginVersion) SET s[$field]=$invalid WITH v MATCH(l:ServerConfig{serverName:'later'}) CREATE(l)-[:INSTALLED{enabled:true,settingsJson:'{}'}]->(v)",{field,invalid:field==='enableDownloads'?'invalid':['invalid']});
 const rows=await old.findConfigurations();assert.deepEqual(await next.findConfigurations(),rows);const ordered=[rows.find(s=>s.serverName==='first')!,rows.find(s=>s.serverName==='later')!];let expected:unknown;
 for(const repo of [old,next]){await driver.executeQuery("MATCH(s:ServerConfig) SET s.pluginPipelines='[]'");const logs:string[]=[];let error='';try{await migrateLegacyPipelineConfigurations({...repo,findConfigurations:async()=>ordered},line=>logs.push(line),materialize);}catch(e){error=(e as Error).message;}assert.match(error,/cannot represent/);assert.deepEqual(logs,[]);const state=await stored();assert.notEqual(state.find(s=>s.name==='first')!.pipelines,'[]');assert.equal(state.find(s=>s.name==='later')!.pipelines,'[]');const value={error,state};if(expected)assert.deepEqual(value,expected);else expected=value;}
});
test('nullable names and literal strings retain write filters and generated coercion',async()=>{
 await driver.executeQuery("CREATE(:ServerConfig{pluginPipelines:'[]'}),(:ServerConfig{serverName:$name,pluginPipelines:'[]'})",{name:'quote"\\'});let expected:unknown;
 for(const repo of [old,next]){await driver.executeQuery("MATCH(s:ServerConfig) SET s.pluginPipelines='[]'");await repo.saveConfiguration(null,'["null"]');await repo.saveConfiguration('quote"\\','["literal"]');const value=await stored();if(expected)assert.deepEqual(value,expected);else expected=value;}
 let message='';for(const repo of [old,next])await assert.rejects(repo.saveConfiguration(123 as never,'[]'),e=>{if(!message)message=(e as Error).message;assert.equal((e as Error).message,message);return true;});
});
