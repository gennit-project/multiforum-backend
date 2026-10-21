import assert from 'node:assert/strict';
import test from 'node:test';
import suspendUser from '../suspendUser.js';
import suspendMod from '../suspendMod.js';
import unsuspendUser from '../unsuspendUser.js';
import unsuspendMod from '../unsuspendMod.js';
const factories={suspendUser:()=>suspendUser({}),suspendMod,unsuspendUser,unsuspendMod};
const setup=(name:keyof typeof factories,scope:'server'|'channel',failure?:string)=>{
 const calls:string[]=[];const inputs:any[]=[];const repository:any={};
 for(const method of ['appendSuspensionActivity','closeSuspensionIssue','addChannelSuspension','addServerSuspension','removeChannelSuspensions','removeServerSuspensions'])repository[method]=async(...args:any[])=>{calls.push(method);inputs.push(args);if(failure===method)throw Error('write failed');return method==='closeSuspensionIssue'?{issues:[{id:'i',issueNumber:1,ActivityFeed:[]}]}:method==='addChannelSuspension'?{channels:[{uniqueName:'forum'}]}:{serverConfigs:[{serverName:'server'}]};};
 const context:any={driver:{},user:{username:'actor',data:{ModerationProfile:{displayName:'Actor'}}},suspensionWriteRepository:repository,issueTargetRepository:{findIssue:async()=>{calls.push('target');return [{Channel:scope==='channel'?{uniqueName:'forum'}:null,relatedUsername:name.endsWith('User')?'target':null,relatedModProfileName:name.endsWith('Mod')?'TargetMod':null}];},findDirectUser:async()=>[{username:'target'}],findProfileOwner:async()=>[{username:'target'}]},notificationSnapshotRepository:{findIssueSubscribers:async()=>{calls.push('notify');if(failure==='notify')throw Error('notify failed');return [];}}};
 return {calls,inputs,repository,context,resolver:factories[name]()};
};
const args={issueId:'i',suspendUntil:'2030-01-01T00:00:00Z',suspendIndefinitely:false,explanation:' reason '};
for(const name of Object.keys(factories) as Array<keyof typeof factories>)for(const scope of ['channel','server'] as const)test(`${name} retains ${scope} write and notification order`,async()=>{
 const t=setup(name,scope);const result=await t.resolver(null,args,t.context,{} as never);assert.equal(result.id,'i');const suspending=name.startsWith('suspend');assert.deepEqual(t.calls,['target',...(suspending?['appendSuspensionActivity']:[]),'closeSuspensionIssue','notify',suspending?(scope==='channel'?'addChannelSuspension':'addServerSuspension'):(scope==='channel'?'removeChannelSuspensions':'removeServerSuspensions')]);
 const update=t.inputs[t.inputs.length-1][1];const field=name.endsWith('Mod')?'SuspendedMods':'SuspendedUsers';assert.ok(update[field]);if(suspending){const node=update[field][0].create[0].node;assert.equal(node.suspendedUntil,args.suspendUntil);assert.equal(node.suspendedIndefinitely,false);assert.equal(node.channelUniqueName,scope==='channel'?'forum':null);if(name.endsWith('Mod'))assert.equal(node.modProfileName,'TargetMod');}else assert.ok(update[field][0].disconnect);
});
for(const failure of ['appendSuspensionActivity','closeSuspensionIssue','notify','addChannelSuspension'])test(`suspension ${failure} failure retains boundary`,async()=>{
 const t=setup('suspendUser','channel',failure);await assert.rejects(t.resolver(null,args,t.context,{} as never),failure==='notify'?/notify failed/:failure==='addChannelSuspension'?/Error updating channel/:/Error updating issue/);const all=['target','appendSuspensionActivity','closeSuspensionIssue','notify','addChannelSuspension'];assert.deepEqual(t.calls,all.slice(0,all.indexOf(failure)+1));
});
for(const scope of ['channel','server'] as const)test(`unsuspend ${scope} failure retains generic contract`,async()=>{const failure=scope==='channel'?'removeChannelSuspensions':'removeServerSuspensions';const t=setup('unsuspendMod',scope,failure);await assert.rejects(t.resolver(null,args,t.context,{} as never),/Error unsuspending user/);assert.deepEqual(t.calls,['target','closeSuspensionIssue','notify',failure]);});
test('missing identifier fails before target; moderator requirement before writes',async()=>{const t=setup('suspendUser','channel');await assert.rejects(t.resolver(null,{...args,issueId:''},t.context,{} as never),/Issue ID is required/);assert.deepEqual(t.calls,[]);t.context.user.data={};await assert.rejects(t.resolver(null,args,t.context,{} as never),/is not a moderator/);assert.deepEqual(t.calls,['target']);});
test('missing close result stops before notification and scope write',async()=>{const t=setup('suspendUser','channel');t.repository.closeSuspensionIssue=async()=>({issues:[]});await assert.rejects(t.resolver(null,args,t.context,{} as never),/Unable to update Issue/);assert.deepEqual(t.calls,['target','appendSuspensionActivity']);});
