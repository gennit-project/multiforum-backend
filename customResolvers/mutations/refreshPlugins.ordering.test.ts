import assert from 'node:assert/strict';
import test from 'node:test';
import getResolver from './refreshPlugins.js';
import type {PluginRegistryRepository} from '../../services/persistence/pluginRegistryRepository.js';
function fixture(overrides:Partial<PluginRegistryRepository>={},artifactId='plugin'){
 const calls:string[]=[];const payloads:unknown[]=[];
 const repository:PluginRegistryRepository={
  findRegistryConfigs:async()=>{calls.push('configs');return [{pluginRegistries:['https://fixture.invalid/registry']}] as any;},
  findOrphanCandidates:async()=>{calls.push('orphans');return [];},
  findPluginsForVersion:async()=>[],findPluginDefaultByName:async()=>[],createOrphanPlugin:async()=>({plugins:[{id:'p',name:'plugin'}] as any}),connectOrphanVersion:async()=>{},
  findPluginByName:async()=>{calls.push('plugin');return [{id:'p',name:'plugin'}] as any;},
  createRegistryPlugin:async input=>{calls.push('create-plugin');payloads.push(input);return {plugins:[{id:'p',name:'plugin'}] as any};},
  updateRegistryPlugin:async(_id,update)=>{calls.push('update-plugin');payloads.push(update);},
  findRegistryVersion:async()=>{calls.push('version');return [];},
  createRegistryVersion:async input=>{calls.push('create-version');payloads.push(input);},
  updateRegistryVersion:async()=>{calls.push('update-version');},
  findRegistryResult:async()=>{calls.push('result');return [{id:'p',name:'plugin',Versions:[]}] as any;},
  ...overrides,
 };
 const resolver=getResolver({driver:{} as never,pluginRegistryRepository:repository},{fetchRegistry:async urls=>{calls.push('fetch');assert.deepEqual(urls,['https://fixture.invalid/registry']);return {plugins:[{id:'plugin',versions:[{version:'registry-version',tarballUrl:'https://fixture.invalid/plugin.tgz',integritySha256:'fixture'}]}]};},readArtifacts:async()=>{calls.push('manifest');return {id:artifactId,version:'manifest-version',entryPath:'index.js',manifest:{name:'Plugin',settingsDefaults:{enabled:true},ui:{type:'object'}}} as any;}});
 return {repository,resolver,calls,payloads,run:()=>resolver(null,{},{} as never,{} as never)};
}
test('registry fetch, orphan repair, manifest and version writes retain their order',async()=>{const f=fixture();await f.run();assert.deepEqual(f.calls,['configs','fetch','orphans','plugin','manifest','update-plugin','version','create-version','result']);const input=(f.payloads[1] as any[])[0];assert.equal(input.version,'manifest-version');assert.equal(input.settingsDefaults,'{"enabled":true}');assert.equal(input.uiSchema,'{"type":"object"}');});
test('missing registries fail with legacy prefix before external fetch',async()=>{const f=fixture({findRegistryConfigs:async()=>[]});await assert.rejects(f.run(),{message:'Failed to refresh plugins: No plugin registries configured'});assert.deepEqual(f.calls,[]);});
test('orphan query failure is swallowed and normal processing continues',async()=>{const f=fixture({findOrphanCandidates:async()=>{throw Error('orphan failure');}});assert.equal((await f.run()).length,1);assert.ok(f.calls.includes('create-version'));});
test('orphan creates missing plugin then connects version before normal processing',async()=>{const f=fixture();f.repository.findOrphanCandidates=async()=>[{id:'v',version:'old',repoUrl:'https://fixture.invalid/plugin.tgz'}] as any;f.repository.findPluginsForVersion=async()=>{f.calls.push('connected');return [];};f.repository.findPluginDefaultByName=async()=>{f.calls.push('default-plugin');return [];};f.repository.createOrphanPlugin=async()=>{f.calls.push('create-orphan-plugin');return {plugins:[{id:'p'}] as any};};f.repository.connectOrphanVersion=async(id,pluginId)=>{f.calls.push('connect-orphan');assert.deepEqual([id,pluginId],['v','p']);};await f.run();assert.deepEqual(f.calls.slice(0,7),['configs','fetch','connected','default-plugin','create-orphan-plugin','connect-orphan','plugin']);});
test('mismatched manifest skips writes and final results',async()=>{const f=fixture({},'other');assert.deepEqual(await f.run(),[]);assert.deepEqual(f.calls,['configs','fetch','orphans','plugin','manifest']);});
test('version write failure retains processed plugin and later final refetch',async()=>{const f=fixture({createRegistryVersion:async()=>{throw Error('version failure');}});assert.equal((await f.run()).length,1);assert.ok(f.calls.includes('update-plugin'));assert.equal(f.calls[f.calls.length-1],'result');});
test('final refetch failure returns original plugin with empty versions',async()=>{const f=fixture({findRegistryResult:async()=>{throw Error('refetch failure');}});assert.deepEqual(await f.run(),[{id:'p',name:'plugin',Versions:[]}]);});
test('missing final refetch silently omits the plugin',async()=>{const f=fixture({findRegistryResult:async()=>[]});assert.deepEqual(await f.run(),[]);});
