import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import getResolver from './installPluginVersion.js';
import type {PluginInstallRepository} from '../../services/persistence/pluginInstallRepository.js';
const bytes=Buffer.from('synthetic tarball');
function fixture(){
 const calls:string[]=[];const payloads:any[]=[];
 const repository:PluginInstallRepository={
  findInstallConfigs:async()=>{calls.push('configs');return [{serverName:'first',pluginRegistries:['https://fixture.invalid/registry']},{serverName:'second'}] as any;},
  findInstallPlugin:async()=>{calls.push('plugin');return [];},findInstallVersion:async()=>{calls.push('version');return [];},
  createInstallPlugin:async input=>{calls.push('create-plugin');payloads.push(input);return {plugins:[{id:'p',name:'plugin'}] as any};},
  updateInstallPlugin:async()=>{calls.push('update-plugin');},
  createInstallVersion:async input=>{calls.push('create-version');payloads.push(input);return {pluginVersions:[{id:'v'}] as any};},
  updateInstallVersion:async()=>{calls.push('update-version');},
  findInstalledVersions:async name=>{calls.push('installed');assert.equal(name,'first');return [];},
  connectInstallation:async(...args)=>{calls.push('connect');payloads.push(args);}
 };
 const dependencies={fetchRegistry:async()=>{calls.push('registry');return {plugins:[{id:'plugin',versions:[{version:'1',tarballUrl:'https://fixture.invalid/tarball',integritySha256:crypto.createHash('sha256').update(bytes).digest('hex')}]}]};},download:async(url:string)=>{calls.push('download');assert.equal(url,'https://fixture.invalid/tarball');return bytes;},readManifest:async()=>{calls.push('manifest');return {id:'plugin',version:'1',entryPath:'index.js',manifest:{name:'Plugin',settingsDefaults:{enabled:true},ui:{type:'object'}}} as any;}};
 const run=()=>getResolver({driver:{} as never,pluginInstallRepository:repository},dependencies)(null,{pluginId:'plugin',version:'1'},{} as never,{} as never);
 return {calls,payloads,repository,dependencies,run};
}
test('install preserves registry, integrity, manifest, independent writes and connect order',async()=>{const f=fixture();await f.run();assert.deepEqual(f.calls,['configs','registry','plugin','version','download','manifest','create-plugin','create-version','installed','connect']);assert.equal(f.payloads[1][0].settingsDefaults,'{"enabled":true}');assert.deepEqual(f.payloads[2],['first','v',null]);});
test('missing configuration stops before external effects',async()=>{const f=fixture();f.repository.findInstallConfigs=async()=>[];await assert.rejects(f.run(),{message:'Failed to install plugin: No plugin registries configured'});assert.deepEqual(f.calls,[]);});
test('integrity failure stops before manifest parsing or writes',async()=>{const f=fixture();f.dependencies.download=async()=>Buffer.from('wrong');await assert.rejects(f.run(),/Failed to install plugin: Tarball integrity verification failed/);assert.deepEqual(f.calls,['configs','registry','plugin','version']);});
for(const field of ['id','version'])test(`manifest ${field} mismatch stops before writes`,async()=>{const f=fixture();f.dependencies.readManifest=async()=>({id:'plugin',version:'1',[field]:'other',manifest:{}} as any);await assert.rejects(f.run(),/Failed to install plugin: Manifest/);assert.ok(!f.calls.some(c=>c.startsWith('create')));});
test('existing records update and already-installed version skips connect',async()=>{const f=fixture();f.repository.findInstallPlugin=async()=>[{id:'p',name:'plugin'}] as any;f.repository.findInstallVersion=async()=>[{id:'v',version:'1',repoUrl:'https://fixture.invalid/tarball'}] as any;f.repository.findInstalledVersions=async()=>[{InstalledVersionsConnection:{edges:[{node:{id:'v'}}]}}] as any;await f.run();assert.deepEqual(f.calls,['configs','registry','download','manifest','update-plugin','update-version']);});
for(const operation of ['createInstallPlugin','createInstallVersion','findInstalledVersions','connectInstallation'] as const)test(`${operation} failure retains prior calls and stops without retry`,async()=>{const f=fixture();let attempts=0;f.repository[operation]=async()=>{attempts++;throw Error('fixture failure');};await assert.rejects(f.run(),{message:'Failed to install plugin: fixture failure'});assert.equal(attempts,1);if(operation==='createInstallVersion')assert.ok(f.calls.includes('create-plugin'));if(operation==='findInstalledVersions'||operation==='connectInstallation')assert.ok(f.calls.includes('create-version'));assert.ok(!f.calls.includes('connect'));});
