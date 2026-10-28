import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Driver} from 'neo4j-driver';
import type {GraphQLResolveInfo} from 'graphql';
import type {GraphQLContext} from '../../types/context.js';
import reportChannel from './reportChannel.js';
import type {ChannelReportRepository} from '../../services/persistence/channelReportRepository.js';
const args={channelUniqueName:'forum',selectedServerRules:['No spam'],reportText:'report'};
const ctx=()=>({user:{username:'alice',email:null,email_verified:true,data:{ModerationProfile:{displayName:'mod'}},dateOfBirth:null}} as GraphQLContext);
const info=null as unknown as GraphQLResolveInfo;
function setup(existing=false,fail=''){
 const order:string[]=[];const inputs:any[]=[];
 const driver={session:()=>({executeWrite:async()=>{order.push('allocate');if(fail==='allocate')throw Error('allocation failed');return{records:[{get:()=>3}]};},close:async()=>{order.push('close');}})} as unknown as Driver;
 const repository:ChannelReportRepository={findChannel:async()=>{order.push('channel');if(fail==='channel')throw Error('channel failed');return fail==='missing'?[]:[{uniqueName:'forum',displayName:'Forum'}];},findExisting:async()=>{order.push('existing');if(fail==='existing')throw Error('existing failed');return existing?[{id:'i',issueNumber:1}]:[];},createIssue:async input=>{order.push('create');inputs.push(input);if(fail==='create')throw Error('specific creation');return{issues:fail==='emptycreate'?[]:[{id:'i',issueNumber:3}]};},appendReport:async params=>{order.push('append');inputs.push(params);if(fail==='append')throw Error('specific append');return{issues:fail==='emptyappend'?[]:[{id:'i',issueNumber:3,relatedChannelUniqueName:'forum'}]};}};
 return{order,inputs,resolve:reportChannel({driver,channelReportRepository:repository})};
}
test('channel reports validate before persistence',async()=>{const x=setup();await assert.rejects(x.resolve(null,{...args,channelUniqueName:''},ctx(),info),/Channel unique name is required/);await assert.rejects(x.resolve(null,{...args,selectedServerRules:[]},ctx(),info),/At least one server rule must be selected/);assert.deepEqual(x.order,[]);});
test('channel report moderator guard runs before persistence',async()=>{const x=setup();const context=ctx();context.user!.data={};await assert.rejects(x.resolve(null,args,context,info),/is not a moderator/);assert.deepEqual(x.order,[]);});
test('channel report creates server-scoped issue before report activity',async()=>{const x=setup();const result=await x.resolve(null,args,ctx(),info);assert.deepEqual(x.order,['channel','existing','allocate','close','create','append']);assert.equal(x.inputs[0].channelUniqueName,null);assert.equal(x.inputs[0].relatedChannelUniqueName,'forum');assert.equal(x.inputs[0].Channel,undefined);assert.equal(x.inputs[0].issueNumber,3);assert.equal(x.inputs[0].title,'[Reported channel] Forum');assert.equal(x.inputs[1].flaggedServerRuleViolation,true);assert.equal(result.relatedChannelUniqueName,'forum');});
test('channel report verifies channel even when reusing an issue',async()=>{const x=setup(true);await x.resolve(null,args,ctx(),info);assert.deepEqual(x.order,['channel','existing','append']);});
for(const phase of ['channel','missing','existing','allocate'])test(`channel report ${phase} failure remains outside write catches`,async()=>{const x=setup(false,phase);await assert.rejects(x.resolve(null,args,ctx(),info),new RegExp(phase==='missing'?'Channel not found':phase==='allocate'?'allocation failed':phase+' failed'));assert.ok(!x.order.includes('create'));assert.ok(!x.order.includes('append'));});
for(const phase of ['create','emptycreate','append','emptyappend'])test(`channel report ${phase} keeps entity-specific write error`,async()=>{const x=setup(false,phase);await assert.rejects(x.resolve(null,args,ctx(),info),new RegExp(phase==='create'?'Error creating issue: specific creation':phase==='emptycreate'?'Error creating issue: Error creating issue':'Error updating issue'));if(phase.includes('create'))assert.ok(!x.order.includes('append'));});
