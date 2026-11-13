import assert from 'node:assert/strict'
import test from 'node:test'
import type { GraphQLResolveInfo } from 'graphql'
import type { GraphQLContext } from '../../types/context.js'
import type { ServerPluginEnablementRepository } from '../../services/persistence/serverPluginEnablementRepository.js'
import create from './enableServerPlugin.js'
test('new policy rejects incompatible plugin version and malformed settings before writes, but disabling is possible',async()=>{
  for(const scenario of [
    {version:'0.7.1',settings:{server:{serverRuleEnforcement:'on',channelRuleEligibility:'all',channelRuleAllowlist:[]}},enabled:true,error:/0.8.0/},
    {version:'0.7.1',settings:{channelRuleAllowlist:[]},enabled:true,error:/0.8.0/},
    {version:'0.8.0',settings:{server:{serverRuleEnforcement:'on',channelRuleEligibility:'all',channelRuleAllowlist:[]}},enabled:true,error:null},
    {version:'0.7.1',settings:{serverRuleEnforcement:'on',channelRuleEligibility:'all',channelRuleAllowlist:[]},enabled:true,error:/0.8.0/},
    {version:'0.8.0',settings:{serverRuleEnforcement:'invalid',channelRuleEligibility:'all',channelRuleAllowlist:[]},enabled:true,error:/on, off, or allowlist/},
    {version:'0.8.0',settings:{serverRuleEnforcement:'on',channelRuleEligibility:'bogus',channelRuleAllowlist:[]},enabled:true,error:/all, none, or allowlist/},
    {version:'0.8.0',settings:{serverRuleEnforcement:'on',channelRuleEligibility:'all',channelRuleAllowlist:[1]},enabled:true,error:/string array/},
    {version:'0.8.0',settings:{serverRuleEnforcement:'on',channelRuleEligibility:'all',channelRuleAllowlist:[]},enabled:true,error:null},
    {version:'0.7.1',settings:{serverRuleEnforcement:'allowlist',serverRuleForumAllowlist:['cats'],channelRuleEligibility:'none',channelRuleAllowlist:[]},enabled:true,error:/0.8.0/},
    {version:'0.8.0',settings:{serverRuleEnforcement:'allowlist',serverRuleForumAllowlist:[],channelRuleEligibility:'all',channelRuleAllowlist:[]},enabled:true,error:null},
    {version:'0.7.1',settings:{serverRuleEnforcement:'invalid'},enabled:false,error:null},
  ]) {
    let writes=0
    const repository={findPlugin:async()=>[{id:'p',name:'llm-moderation',Versions:[{id:'v',version:scenario.version,manifest:{}}]}],
      findInstallations:async()=>[{serverName:'server',InstalledVersions:[{id:'v'}]}],findSecrets:async()=>[],setInstallation:async()=>{writes++}} as unknown as ServerPluginEnablementRepository
    const result=create({repository})({}, {pluginId:'llm-moderation',...scenario,settingsJson:scenario.settings},{} as GraphQLContext,{} as GraphQLResolveInfo)
    if(scenario.error) await assert.rejects(result,scenario.error);else await result
    assert.equal(writes,scenario.error?0:1)
  }
})
