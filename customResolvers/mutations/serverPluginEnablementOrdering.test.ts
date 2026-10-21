import assert from 'node:assert/strict';
import test from 'node:test';
import type {GraphQLResolveInfo} from 'graphql';
import type {GraphQLContext} from '../../types/context.js';
import getResolver from './enableServerPlugin.js';
import type {ServerPluginEnablementRepository} from '../../services/persistence/serverPluginEnablementRepository.js';
const harness=(failure?:string,missing?:string,manifest:unknown={settings:[]})=>{
 const calls:string[]=[];const values:unknown[]=[];
 const step=(name:string,value:unknown)=>{calls.push(name);if(failure===name)throw Error('fixture failure');return value;};
 const repository={
  findPlugin:async(...args:unknown[])=>{values.push(args);return step('plugin',missing==='plugin'?[]:[{id:'p',name:'plugin',Versions:missing==='version'?[]:[{id:'v',manifest}]}]);},
  findInstallations:async(...args:unknown[])=>{values.push(args);return step('installation',missing==='server'?[]:[{serverName:'server',InstalledVersions:missing==='installation'?[]:[{id:'v'}],InstalledVersionsConnection:{edges:[{properties:{settingsJson:'{"saved":true}'}}]}}]);},
  findSecrets:async()=>step('secrets',[]),
  setInstallation:async(...args:unknown[])=>{values.push(args);step('write',undefined);},
 } as unknown as ServerPluginEnablementRepository;
 return {calls,values,resolve:(enabled=true,settingsJson?:Record<string,unknown>)=>getResolver({repository})(null,{pluginId:'plugin',version:'1',enabled,settingsJson},{} as GraphQLContext,{} as GraphQLResolveInfo)};
};
test('enable preserves lookup/validation/write ordering and saved settings',async()=>{const h=harness();const result=await h.resolve();assert.deepEqual(h.calls,['plugin','installation','secrets','write']);assert.deepEqual(result.settingsJson,{saved:true});assert.deepEqual(h.values[h.values.length-1],['server','v',true,'{"saved":true}']);});
test('disable skips secrets and explicit empty settings clear edge settings',async()=>{const h=harness();await h.resolve(false,{});assert.deepEqual(h.calls,['plugin','installation','write']);assert.deepEqual(h.values[h.values.length-1],['server','v',false,null]);});
for(const [missing,message,steps] of [['plugin','Plugin plugin not found',['plugin']],['version','Plugin plugin version 1 not found',['plugin']],['server','Server configuration not found',['plugin','installation']],['installation','is not installed',['plugin','installation']]] as const)test(`missing ${missing} preserves error and stops later effects`,async()=>{const h=harness(undefined,missing);await assert.rejects(h.resolve(),error=>String(error).includes('Failed to enable plugin:')&&String(error).includes(message));assert.deepEqual(h.calls,steps);});
for(const failure of ['plugin','installation','secrets','write'])test(`${failure} failure preserves prefix and later-effect boundary`,async()=>{const h=harness(failure);await assert.rejects(h.resolve(),{message:'Failed to enable plugin: fixture failure'});assert.equal(h.calls[h.calls.length-1],failure);});

test('required server configuration rejects before installation write; disabling bypasses validation',async()=>{
 const manifest={secrets:[{key:'API_KEY',scope:'server',required:true}]};
 const blocked=harness(undefined,undefined,manifest);
 await assert.rejects(blocked.resolve(),/Failed to enable plugin: PLUGIN_CONFIG_INCOMPLETE:/);
 assert.deepEqual(blocked.calls,['plugin','installation','secrets']);
 const disabled=harness(undefined,undefined,manifest);await disabled.resolve(false);assert.deepEqual(disabled.calls,['plugin','installation','write']);
});
