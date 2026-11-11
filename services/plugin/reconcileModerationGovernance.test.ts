import assert from 'node:assert/strict'
import test from 'node:test'
import { preserveModerationGovernance } from './reconcileModerationGovernance.js'
import { reconcileSettings } from './reconcileSettings.js'
test('stale declarative allowlist preserves approvals and explicit new mode removes legacy server gate',()=>{
  const actual=preserveModerationGovernance({serverRuleCheckMode:'allowlist',serverRuleForumAllowlist:['old'],channelRuleAllowlist:['approved']},
    {serverRuleEnforcement:'off',channelRuleEligibility:'allowlist',channelRuleAllowlist:['trial']})
  assert.deepEqual(actual,{serverRuleEnforcement:'off',channelRuleEligibility:'allowlist',channelRuleAllowlist:['trial','approved']})
})
test('omitted governance fields stay unchanged by reconciliation',()=>{
  const actual=preserveModerationGovernance('{"serverRuleEnforcement":"on","channelRuleEligibility":"none","channelRuleAllowlist":["approved"]}',{model:'new'})
  assert.equal(actual.serverRuleEnforcement,'on');assert.equal(actual.channelRuleEligibility,'none');assert.deepEqual(actual.channelRuleAllowlist,['approved'])
})
test('version upgrade preserves legacy enforcement without silently migrating to new defaults',()=>{
  const result=reconcileSettings({scope:'server',oldSettings:{serverRuleCheckMode:'allowlist',serverRuleForumAllowlist:['trial']},
    newManifest:{settingsDefaults:{server:{serverRuleEnforcement:'off'}},ui:{forms:{server:[{fields:[{key:'serverRuleEnforcement',type:'string'}]}]}}}})
  assert.equal(result.settings.serverRuleEnforcement,undefined)
  assert.equal(result.settings.serverRuleCheckMode,'allowlist');assert.deepEqual(result.settings.serverRuleForumAllowlist,['trial'])
  assert.deepEqual(result.report.dropped,[])
})
test('nested legacy settings survive upgrade and deleted defaults are not reported as applied',()=>{
  const result=reconcileSettings({scope:'server',oldSettings:{server:{serverRuleCheckMode:'allowlist',serverRuleForumAllowlist:['trial']}},
    newManifest:{settingsDefaults:{server:{serverRuleEnforcement:'off'}},ui:{forms:{server:[{fields:[{key:'serverRuleEnforcement',type:'string'}]}]}}}})
  assert.equal(result.settings.serverRuleEnforcement,undefined)
  assert.equal(result.settings.serverRuleCheckMode,'allowlist');assert.deepEqual(result.settings.serverRuleForumAllowlist,['trial'])
  assert.ok(!result.report.newDefaults.includes('serverRuleEnforcement'))
})

test('reconciliation refuses ineligible channel enablement before any writes',async()=>{
  const {buildPluginConfigurationReconciliationPlan,PLUGIN_CONFIGURATION_API_VERSION}=await import('./configurationReconciliation.js')
  const plan=buildPluginConfigurationReconciliationPlan({desired:{apiVersion:PLUGIN_CONFIGURATION_API_VERSION,
    plugins:[{pluginId:'llm-moderation',version:'0.8.0',enabled:true,settingsJson:{serverRuleEnforcement:'on',channelRuleEligibility:'none',channelRuleAllowlist:[]}}],
    channelPlugins:[{channelUniqueName:'cats',pluginId:'llm-moderation',version:'0.8.0',enabled:true}]},
    live:{plugins:[],secrets:[],pipelines:[],channels:[{channelUniqueName:'cats',plugins:[]}]}})
  assert.ok(plan.changes.some(change=>change.kind==='ENABLE_CHANNEL_PLUGIN'&&change.blocked))
})
test('explicit desired nested policy wins over previous flat policy',()=>{
  const actual=preserveModerationGovernance({serverRuleEnforcement:'on',channelRuleEligibility:'all',channelRuleAllowlist:['approved']},
    {server:{serverRuleEnforcement:'off',channelRuleEligibility:'none',channelRuleAllowlist:[]}})
  assert.equal(actual.serverRuleEnforcement,'off');assert.equal(actual.channelRuleEligibility,'none')
  assert.deepEqual(actual.channelRuleAllowlist,['approved'])
})
test('legacy carryover also preserves absence if a future manifest introduces channel defaults',()=>{
  const result=reconcileSettings({scope:'server',oldSettings:{serverRuleCheckMode:'allowlist',serverRuleForumAllowlist:['trial']},
    newManifest:{settingsDefaults:{server:{serverRuleEnforcement:'off',channelRuleEligibility:'all',channelRuleAllowlist:[]}},ui:{forms:{server:[{fields:[{key:'serverRuleEnforcement',type:'select'}]}]}}}})
  assert.deepEqual(result.settings,{serverRuleCheckMode:'allowlist',serverRuleForumAllowlist:['trial']})
  assert.deepEqual(result.report.newDefaults,[])
})

test('version upgrade planner carries the current governing approvals into new settings and eligibility',async()=>{
  const {buildPluginConfigurationReconciliationPlan,PLUGIN_CONFIGURATION_API_VERSION}=await import('./configurationReconciliation.js')
  const plan=buildPluginConfigurationReconciliationPlan({desired:{apiVersion:PLUGIN_CONFIGURATION_API_VERSION,
    plugins:[{pluginId:'llm-moderation',version:'0.9.0',enabled:true,settingsJson:{serverRuleEnforcement:'on',channelRuleEligibility:'allowlist',channelRuleAllowlist:['trial']}}],
    channelPlugins:[{channelUniqueName:'approved',pluginId:'llm-moderation',version:'0.9.0',enabled:true}]},
    live:{plugins:[
      {pluginId:'llm-moderation',version:'0.8.0',enabled:true,settingsJson:JSON.stringify({serverRuleEnforcement:'on',channelRuleEligibility:'allowlist',channelRuleAllowlist:['approved']})},
      {pluginId:'llm-moderation',version:'0.7.0',enabled:true,settingsJson:JSON.stringify({channelRuleAllowlist:['obsolete']})},
      {pluginId:'llm-moderation',version:'0.9.0',enabled:false,settingsJson:JSON.stringify({channelRuleAllowlist:['inactive']})},
    ],secrets:[],pipelines:[],channels:[{channelUniqueName:'approved',plugins:[]}]}})
  const settings=plan.changes.find(change=>change.kind==='UPDATE_SETTINGS')?.desired as Record<string,unknown>
  assert.deepEqual(settings.channelRuleAllowlist,['trial','approved'])
  assert.equal(plan.changes.find(change=>change.kind==='ENABLE_CHANNEL_PLUGIN')?.blocked,false)
})
