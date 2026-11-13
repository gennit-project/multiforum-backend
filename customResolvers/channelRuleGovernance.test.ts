import assert from 'node:assert/strict'
import test from 'node:test'
import type { Driver } from 'neo4j-driver'
import type { GraphQLContext } from '../types/context.js'
import { channelRuleGovernanceResolvers } from './channelRuleGovernance.js'
import { governanceStatus, type ChannelRuleGovernanceRepository } from '../services/persistence/channelRuleGovernanceRepository.js'

function fixture() {
  const calls:unknown[][]=[]
  const status=governanceStatus(null,'cats',false,null)
  const request={id:'request',issueNumber:2,channelUniqueName:'cats',pluginId:'llm-moderation',isOpen:true}
  const repository:ChannelRuleGovernanceRepository={
    status:async(...args)=>{calls.push(['status',...args]);return status},
    setEnabled:async(...args)=>{calls.push(['setEnabled',...args]);return true},
    request:async(...args)=>{calls.push(['request',...args]);return request},
    approve:async(...args)=>{calls.push(['approve',...args]);return {...request,isOpen:false}},
  }
  return {calls,status,resolvers:channelRuleGovernanceResolvers({} as Driver,repository)}
}
test('governance resolver read and owner toggle preserve the exact target and result',async()=>{
  const f=fixture();const args={channelUniqueName:'cats',pluginId:'llm-moderation'}
  assert.equal(await f.resolvers.getChannelRuleGovernance(null,args),f.status)
  assert.equal(await f.resolvers.setChannelRuleEnforcement(null,{...args,enabled:false}),true)
  assert.deepEqual(f.calls,[['status','cats','llm-moderation'],['setEnabled','cats','llm-moderation',false]])
})
test('request and approval attribute writes to the authenticated actor, never caller-supplied identity',async()=>{
  const f=fixture();const context={user:{username:'verified-actor'}} as GraphQLContext
  const args={channelUniqueName:'cats',pluginId:'llm-moderation',username:'spoofed'}
  assert.equal((await f.resolvers.requestChannelRuleEnforcement(null,args,context)).isOpen,true)
  assert.equal((await f.resolvers.approveChannelRuleEnforcement(null,{issueId:'request'},context)).isOpen,false)
  assert.deepEqual(f.calls,[['request','cats','llm-moderation','verified-actor'],['approve','request','verified-actor']])
})
test('request and approval fail before persistence when identity is missing',async()=>{
  const f=fixture()
  await assert.rejects(f.resolvers.requestChannelRuleEnforcement(null,{channelUniqueName:'cats',pluginId:'llm-moderation'},{} as GraphQLContext),/Authentication required/)
  await assert.rejects(f.resolvers.approveChannelRuleEnforcement(null,{issueId:'request'},{} as GraphQLContext),/Authentication required/)
  assert.deepEqual(f.calls,[])
})
test('governance resolvers propagate repository failure without inventing a success',async()=>{
  const broken:ChannelRuleGovernanceRepository={status:async()=>{throw Error('policy unavailable')},setEnabled:async()=>{throw Error('policy changed')},request:async()=>{throw Error('cannot request')},approve:async()=>{throw Error('request changed')}}
  const resolvers=channelRuleGovernanceResolvers({} as Driver,broken)
  const context={user:{username:'actor'}} as GraphQLContext
  await assert.rejects(resolvers.getChannelRuleGovernance(null,{channelUniqueName:'cats',pluginId:'llm-moderation'}),/policy unavailable/)
  await assert.rejects(resolvers.setChannelRuleEnforcement(null,{channelUniqueName:'cats',pluginId:'llm-moderation',enabled:true}),/policy changed/)
  await assert.rejects(resolvers.requestChannelRuleEnforcement(null,{channelUniqueName:'cats',pluginId:'llm-moderation'},context),/cannot request/)
  await assert.rejects(resolvers.approveChannelRuleEnforcement(null,{issueId:'i'},context),/request changed/)
})
