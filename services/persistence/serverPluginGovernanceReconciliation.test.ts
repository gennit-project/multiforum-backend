import assert from 'node:assert/strict'
import test from 'node:test'
import type { Driver, ManagedTransaction } from 'neo4j-driver'
import { createServerPluginEnablementRepository } from './serverPluginEnablementRepository.js'
test('apply locks server and preserves approvals that arrived after preview',async()=>{
  const queries:string[]=[];let stored:Record<string,unknown>={}
  const tx={run:async(query:string,params:Record<string,unknown>={})=>{
    queries.push(query)
    if(query.includes('RETURN e.settingsJson')) return {records:[{get:(key:string)=>key==='version'?'0.8.0':'{"serverRuleEnforcement":"on","channelRuleEligibility":"allowlist","channelRuleAllowlist":["approved-after-preview"]}'}]}
    if(params.settings) stored=JSON.parse(String(params.settings))
    return {records:[]}
  }} as unknown as ManagedTransaction
  const driver={session:()=>({executeWrite:(fn:(tx:ManagedTransaction)=>unknown)=>fn(tx),close:async()=>{}})} as unknown as Driver
  await createServerPluginEnablementRepository(driver).setInstallation('server','v',true,
    '{"serverRuleEnforcement":"on","channelRuleEligibility":"allowlist","channelRuleAllowlist":["trial"]}',true)
  assert.match(queries[0],/_channelGovernanceLock/)
  assert.deepEqual(stored.channelRuleAllowlist,['trial','approved-after-preview'])
})

for(const mode of [true,'upgrade'] as const) {
  test(`version activation (${mode}) reads governing approvals under lock, including grants after preview`,async()=>{
    const queries:string[]=[];let stored:Record<string,unknown>={}
    const tx={run:async(query:string,params:Record<string,unknown>={})=>{
      queries.push(query)
      if(query.includes('RETURN e.settingsJson')) return {records:[{get:(key:string)=>key==='version'?'0.9.0':JSON.stringify({channelRuleAllowlist:['inactive-target']})}]}
      if(query.includes('RETURN v.id AS id')) return {records:[
        {id:'older',version:'0.7.0',settings:JSON.stringify({channelRuleAllowlist:['obsolete']})},
        {id:'governing',version:'0.8.0',settings:JSON.stringify({serverRuleEnforcement:'on',channelRuleEligibility:'allowlist',channelRuleAllowlist:['approved','approved-after-preview']})},
      ].map(row=>({get:(key:keyof typeof row)=>row[key]}))}
      if(params.settings) stored=JSON.parse(String(params.settings))
      return {records:[]}
    }} as unknown as ManagedTransaction
    const driver={session:()=>({executeWrite:(fn:(tx:ManagedTransaction)=>unknown)=>fn(tx),close:async()=>{}})} as unknown as Driver
    const actual=await createServerPluginEnablementRepository(driver).setInstallation('server','new-version',true,
      '{"serverRuleEnforcement":"on","channelRuleEligibility":"allowlist","channelRuleAllowlist":["trial"]}',mode)
    assert.match(queries[0],/_channelGovernanceLock/)
    assert.deepEqual(stored.channelRuleAllowlist,['trial','approved','approved-after-preview'])
    assert.deepEqual(actual,stored)
  })
}

test('explicit same-version admin edit can revoke grants while reconciliation preserves them',async()=>{
  for(const mode of [true,'upgrade'] as const) {
    let stored:Record<string,unknown>={}
    const settings=JSON.stringify({serverRuleEnforcement:'on',channelRuleEligibility:'allowlist',channelRuleAllowlist:['approved']})
    const tx={run:async(query:string,params:Record<string,unknown>={})=>{
      if(query.includes('RETURN e.settingsJson')) return {records:[{get:(key:string)=>key==='version'?'0.8.0':settings}]}
      if(query.includes('RETURN v.id AS id')) return {records:[{get:(key:string)=>({id:'same',version:'0.8.0',settings})[key as 'id'|'version'|'settings']}]}
      if(params.settings) stored=JSON.parse(String(params.settings))
      return {records:[]}
    }} as unknown as ManagedTransaction
    const driver={session:()=>({executeWrite:(fn:(tx:ManagedTransaction)=>unknown)=>fn(tx),close:async()=>{}})} as unknown as Driver
    await createServerPluginEnablementRepository(driver).setInstallation('server','same',true,
      '{"serverRuleEnforcement":"on","channelRuleEligibility":"allowlist","channelRuleAllowlist":[]}',mode)
    assert.deepEqual(stored.channelRuleAllowlist,mode===true?['approved']:[])
  }
})


test('version compatibility is rechecked after merging current governance into an older target',async()=>{
  let writes=0
  const tx={run:async(query:string,params:Record<string,unknown>={})=>{
    if(query.includes('RETURN e.settingsJson')) return {records:[{get:(key:string)=>key==='version'?'0.7.1':'{}'}]}
    if(query.includes('RETURN v.id AS id')) return {records:[{get:(key:string)=>({id:'current',version:'0.8.0',settings:JSON.stringify({serverRuleEnforcement:'on',channelRuleEligibility:'allowlist',channelRuleAllowlist:['approved']})})[key as 'id'|'version'|'settings']}]}
    if(params.settings) writes++
    return {records:[]}
  }} as unknown as ManagedTransaction
  const driver={session:()=>({executeWrite:(fn:(tx:ManagedTransaction)=>unknown)=>fn(tx),close:async()=>{}})} as unknown as Driver
  await assert.rejects(createServerPluginEnablementRepository(driver).setInstallation('server','old-version',true,'{}','upgrade'),/0.8.0/)
  assert.equal(writes,0)
})
