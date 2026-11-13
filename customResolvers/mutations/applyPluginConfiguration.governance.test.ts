import assert from 'node:assert/strict'
import test from 'node:test'
import type { Driver, ManagedTransaction } from 'neo4j-driver'
import type { GraphQLResolveInfo } from 'graphql'
import type { GraphQLContext } from '../../types/context.js'
import type { PluginConfigurationDesiredStateInput } from '../../src/generated/graphql.js'
import { createServerPluginEnablementRepository } from '../../services/persistence/serverPluginEnablementRepository.js'
import { buildPluginConfigurationReconciliationPlan, PLUGIN_CONFIGURATION_API_VERSION } from '../../services/plugin/configurationReconciliation.js'
import { mapPluginConfigurationDesiredStateInput } from '../queries/previewPluginConfigurationReconciliation.js'
import { compareVersions } from '../../services/plugin/pipelineUtils.js'
import { createApplyPluginConfigurationResolver } from './applyPluginConfiguration.js'

const policy = (names:string[]) => ({serverRuleEnforcement:'on',channelRuleEligibility:'allowlist',channelRuleAllowlist:names})
type Installation = { id:string; version:string; enabled:boolean; settings:ReturnType<typeof policy> }
const row = (value:Record<string,unknown>) => ({get:(key:string)=>value[key]})

// Execute the real enablement repository through the real apply composition.
// This database double models statement effects, rather than stubbing configure.
function stateDriver(installations:Installation[]) {
  const tx={run:async(query:string,params:Record<string,unknown>={})=>{
    if(query.includes('_channelGovernanceLock')) return {records:[]}
    if(query.includes('RETURN e.settingsJson')) {
      const found=installations.find(entry=>entry.id===params.id)
      return {records:found?[row({settings:JSON.stringify(found.settings),version:found.version})]:[]}
    }
    if(query.includes('RETURN v.id AS id')) return {records:installations.filter(entry=>entry.enabled).map(entry=>row({id:entry.id,version:entry.version,settings:JSON.stringify(entry.settings)}))}
    if(query.includes('SET e.')) {
      const found=installations.find(entry=>entry.id===params.id)!
      found.settings=JSON.parse(String(params.settings))
      if(Object.prototype.hasOwnProperty.call(params,'enabled')) found.enabled=Boolean(params.enabled)
      return {records:[]}
    }
    assert.fail(`Unexpected query: ${query}`)
  }} as unknown as ManagedTransaction
  return {session:()=>({executeWrite:(fn:(tx:ManagedTransaction)=>unknown)=>fn(tx),close:async()=>{}})} as unknown as Driver
}

for(const disableFirst of [true,false]) for(const downgrade of [false,true]) {
  test(`declarative ${downgrade?'fallback':'upgrade'} preserves concurrent grants with disable ${disableFirst?'first':'last'} in manifest`,async()=>{
    const oldVersion=downgrade?'0.9.0':'0.8.0'
    const newVersion=downgrade?'0.8.0':'0.9.0'
    const installations:Installation[]=[
      {id:oldVersion,version:oldVersion,enabled:true,settings:policy(['approved-before-preview'])},
      {id:newVersion,version:newVersion,enabled:false,settings:policy([])},
    ]
    const oldEntry={pluginId:'llm-moderation',version:oldVersion,enabled:false}
    const newEntry={pluginId:'llm-moderation',version:newVersion,enabled:true,settingsJson:policy(['trial'])}
    const manifest:PluginConfigurationDesiredStateInput={apiVersion:PLUGIN_CONFIGURATION_API_VERSION,
      plugins:disableFirst?[oldEntry,newEntry]:[newEntry,oldEntry],
      channelPlugins:[{channelUniqueName:'approved-before-preview',pluginId:'llm-moderation',version:newVersion,enabled:true}],
    }
    const desired=mapPluginConfigurationDesiredStateInput(manifest)
    const repository=createServerPluginEnablementRepository(stateDriver(installations))
    const configured:string[]=[]
    let previews=0
    let channelEnabled=false
    const resolver=createApplyPluginConfigurationResolver({},()=>({
      preview:async()=>{
        const plan=buildPluginConfigurationReconciliationPlan({desired,live:{plugins:installations.map(entry=>({pluginId:'llm-moderation',version:entry.version,enabled:entry.enabled,settingsJson:JSON.stringify(entry.settings)})),secrets:[],pipelines:[],channels:[{channelUniqueName:'approved-before-preview',plugins:channelEnabled?[{pluginId:'llm-moderation',version:newVersion,enabled:true,settingsJson:'{}'}]:[]}]}})
        if(++previews===1) installations[0].settings.channelRuleAllowlist.push('approved-after-preview')
        return plan
      },
      install:async()=>assert.fail('already installed'),setSecret:async()=>assert.fail('no secret changes'),updatePipelines:async()=>assert.fail('no pipeline changes'),
      configure:async args=>{
        configured.push(args.version)
        await repository.setInstallation('server',args.version,args.enabled,JSON.stringify(args.settingsJson??installations.find(entry=>entry.id===args.version)!.settings),true)
        if(args.enabled) {
          const governor=installations.filter(entry=>entry.enabled).sort((a,b)=>compareVersions(b.version,a.version))[0]
          governor.settings.channelRuleAllowlist.push('approved-after-activation')
        }
      },
      configureChannelPlugin:async()=>{channelEnabled=true},
    }))
    const result=await resolver(null,{manifest},{} as GraphQLContext,{} as GraphQLResolveInfo)
    assert.equal(result.status,'SUCCEEDED',JSON.stringify(result))
    assert.deepEqual(configured,[newVersion,oldVersion])
    assert.equal(installations[0].enabled,false)
    assert.equal(installations[1].enabled,true)
    assert.deepEqual(installations[1].settings.channelRuleAllowlist.sort(),['approved-after-activation','approved-after-preview','approved-before-preview','trial'])
  })
}

test('replacement configuration failure leaves the existing governor active',async()=>{
  const manifest:PluginConfigurationDesiredStateInput={apiVersion:PLUGIN_CONFIGURATION_API_VERSION,plugins:[
    {pluginId:'llm-moderation',version:'0.8.0',enabled:false},
    {pluginId:'llm-moderation',version:'0.9.0',enabled:true,settingsJson:policy([])},
  ]}
  const desired=mapPluginConfigurationDesiredStateInput(manifest)
  const calls:string[]=[]
  const resolver=createApplyPluginConfigurationResolver({},()=>({
    preview:async()=>buildPluginConfigurationReconciliationPlan({desired,live:{plugins:[{pluginId:'llm-moderation',version:'0.8.0',enabled:true,settingsJson:JSON.stringify(policy(['approved']))},{pluginId:'llm-moderation',version:'0.9.0',enabled:false,settingsJson:'{}'}],secrets:[],pipelines:[]}}),
    install:async()=>{},setSecret:async()=>{},updatePipelines:async()=>{},
    configure:async args=>{calls.push(args.version);throw new Error('configuration rejected')},
  }))
  const result=await resolver(null,{manifest},{} as GraphQLContext,{} as GraphQLResolveInfo)
  assert.equal(result.status,'FAILED')
  assert.deepEqual(calls,['0.9.0'])
})
