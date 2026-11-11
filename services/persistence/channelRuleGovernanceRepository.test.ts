import assert from 'node:assert/strict'
import test from 'node:test'
import type { Driver, ManagedTransaction } from 'neo4j-driver'
import { governanceStatus, createChannelRuleGovernanceRepository } from './channelRuleGovernanceRepository.js'
const installed = (settings:Record<string,unknown>) => ({id:'v',version:'0.8.0',settings})
test('governance status distinguishes off, legacy migration, eligibility, opt-in and pending request', () => {
  assert.equal(governanceStatus(null,'cats',false,null).canRequest,false)
  const legacy=governanceStatus(installed({serverRuleCheckMode:'allowlist',serverRuleForumAllowlist:['dogs']}),'cats',true,null)
  assert.equal(legacy.migrationRequired,true);assert.equal(legacy.serverRuleEnforcement,'legacy_allowlist');assert.equal(legacy.eligible,true)
  const settings={serverRuleEnforcement:'on',channelRuleEligibility:'allowlist',channelRuleAllowlist:['dogs']}
  const denied=governanceStatus(installed(settings),'cats',true,null)
  assert.equal(denied.eligible,false);assert.equal(denied.ownerEnabled,true);assert.equal(denied.canRequest,true)
  const pending={id:'i',issueNumber:2,channelUniqueName:'cats',pluginId:'llm-moderation',isOpen:true}
  assert.equal(governanceStatus(installed(settings),'cats',true,pending).canRequest,false)
  assert.equal(governanceStatus(installed(settings),'cats',true,pending).pendingRequestNumber,2)
})
function scripted(rows:Array<Record<string,unknown>[]>) {
  const calls:Array<{query:string;params:Record<string,unknown>}> = []
  let closed=false
  const tx={run:async(query:string,params:Record<string,unknown>={})=>{
    calls.push({query,params});const next=rows.shift();assert.ok(next,query)
    return {records:next.map(row=>({get:(key:string)=>row[key]}))}
  }} as unknown as ManagedTransaction
  const driver={session:()=>({executeWrite:(fn:(tx:ManagedTransaction)=>unknown)=>fn(tx),close:async()=>{closed=true}})} as unknown as Driver
  return {repo:createChannelRuleGovernanceRepository(driver),calls,done:()=>{assert.equal(rows.length,0);assert.equal(closed,true)}}
}
test('denied channel enablement performs no ENABLED write', async()=>{
  const fixture=scripted([[{count:1}],[{count:1}],[{id:'v',version:'0.8.0',settings:JSON.stringify({channelRuleEligibility:'none'})}]])
  await assert.rejects(fixture.repo.setEnabled('cats','llm-moderation',true),/not eligible/)
  assert.ok(fixture.calls.every(call=>!call.query.includes('SET e.enabled')));fixture.done()
})
test('request is idempotent and server scoped',async()=>{
  const existing={id:'i',issueNumber:1,relatedChannelUniqueName:'cats',requestedPluginId:'llm-moderation',isOpen:true}
  const fixture=scripted([[{count:1}],[{count:1}],[{issue:existing}]])
  assert.equal((await fixture.repo.request('cats','llm-moderation','owner')).id,'i')
  assert.ok(fixture.calls[2].query.includes('i.channelUniqueName IS NULL'));fixture.done()
})
test('approval adds only eligibility, preserves unrelated settings and closes request atomically',async()=>{
  const issue={id:'i',issueNumber:3,relatedChannelUniqueName:'cats',requestedPluginId:'llm-moderation',isOpen:true}
  const fixture=scripted([[{count:1}],[{issue}],[{count:1}],[{id:'v',version:'0.8.0',settings:JSON.stringify({channelRuleEligibility:'allowlist',channelRuleAllowlist:['dogs'],model:'saved'})}],[],[]])
  const result=await fixture.repo.approve('i','admin')
  assert.equal(result.isOpen,false)
  const settings=JSON.parse(String(fixture.calls[4].params.settings))
  assert.deepEqual(settings.channelRuleAllowlist,['dogs','cats']);assert.equal(settings.model,'saved')
  assert.ok(fixture.calls.every(call=>!call.query.includes(':ENABLED')))
  assert.equal(fixture.calls[5].params.username,'admin');fixture.done()
})
test('approval rejects stale policy without touching allowlist or closing issue',async()=>{
  const issue={id:'i',issueNumber:3,relatedChannelUniqueName:'cats',requestedPluginId:'llm-moderation',isOpen:true}
  const fixture=scripted([[{count:1}],[{issue}],[{count:1}],[{id:'v',version:'0.8.0',settings:'{"channelRuleEligibility":"none"}'}]])
  await assert.rejects(fixture.repo.approve('i','admin'),/no longer allowlist/);fixture.done()
})
test('closed approved retry is idempotent; ordinary closed request is not approved',async()=>{
  for(const approved of [true,false]) {
    const issue={id:'i',issueNumber:3,relatedChannelUniqueName:'cats',requestedPluginId:'llm-moderation',isOpen:false,...(approved?{channelRuleApprovedAt:'then'}:{})}
    const fixture=scripted([[{count:1}],[{issue}]])
    if(approved) assert.equal((await fixture.repo.approve('i','admin')).isOpen,false)
    else await assert.rejects(fixture.repo.approve('i','admin'),/closed/)
    fixture.done()
  }
})
