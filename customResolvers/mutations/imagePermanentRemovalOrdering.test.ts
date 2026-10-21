import assert from 'node:assert/strict';
import {test,before,after,afterEach,mock} from 'node:test';
import http from 'node:http';
import https from 'node:https';
import {Storage} from '@google-cloud/storage';
import remove from './permanentlyRemoveImage.js';
let attempts=0;let guards:ReturnType<typeof mock.method>[]=[];
before(()=>{const deny=()=>{attempts++;throw Error('Unexpected external IO');};guards=[mock.method(Storage.prototype,'bucket',deny),mock.method(globalThis,'fetch',deny),mock.method(http,'request',deny),mock.method(http,'get',deny),mock.method(https,'request',deny),mock.method(https,'get',deny)];});
afterEach(()=>assert.equal(attempts,0));after(()=>guards.forEach(g=>g.mock.restore()));
function fixture(fail='',existing=true){
 const calls:string[]=[];const issue={id:'i',issueNumber:7,flaggedServerRuleViolation:true};
 const step=async(name:string,result:any)=>{calls.push(name);if(name===fail)throw Error('failed '+name);return result;};
 const target=[{id:'c',url:'https://example.invalid/image'}];
 const repository:any={findPermanentRemovalTarget:()=>step('target',target),findUnarchiveTarget:()=>step('target',target),findIssue:()=>step('issue',existing?[issue]:[]),createModerationIssue:()=>step('create',{issues:[issue]}),appendIssueAction:(_where:any,update:any)=>step(update.isOpen===false?'close':'activity',{issues:[issue]}),updateModerationState:()=>step('image',{images:[{id:'c'}]})};
 const driver:any={session:()=>({executeWrite:()=>step('number',{records:[{get:()=>7}]}),close:async()=>{calls.push('session-close');}})};
 const context:any={driver,user:{username:'mod-user',data:{ModerationProfile:{displayName:'mod'}}},notificationSnapshotRepository:{findIssueSubscribers:()=>step('notify',[])}};
 return {calls,repository,driver,context,issue};
}
const args={imageId:'c',explanation:'reason'};
test('removal preserves issue actions, subscriber notification then flag-write order',async()=>{const f=fixture();assert.deepEqual(await remove(f)(null,args,f.context,{} as any),f.issue);assert.deepEqual(f.calls,['target','issue','activity','close','notify','image']);});
for(const [failure,expected] of [['target','failed target'],['issue','failed issue'],['activity','Error updating issue'],['close','Error updating issue'],['notify','Error updating issue'],['image','Error updating image']])test('removal preserves '+failure+' failure boundary',async()=>{const f=fixture(failure);await assert.rejects(remove(f)(null,args,f.context,{} as any),{message:expected});assert.equal(f.calls[f.calls.length-1],failure);});
test('missing ID rejects before persistence',async()=>{const f=fixture();await assert.rejects(remove(f)(null,{...args,imageId:''},f.context,{} as any),/Image ID is required/);assert.deepEqual(f.calls,[]);});
test('anonymous rejects before persistence',async()=>{const f=fixture();f.context.user=null;await assert.rejects(remove(f)(null,args,f.context,{} as any),/User must be logged in/);assert.deepEqual(f.calls,[]);});
test('nonmoderator rejects before persistence',async()=>{const f=fixture();f.context.user.data={};await assert.rejects(remove(f)(null,args,f.context,{} as any),/is not a moderator/);assert.deepEqual(f.calls,[]);});
for(const [target,error] of [[[],/Image not found/],[[{id:'c',permanentlyRemoved:true}],/already been permanently removed/]] as const)test('target rejection '+error,async()=>{const f=fixture();f.repository.findPermanentRemovalTarget=async()=>target;await assert.rejects(remove(f)(null,args,f.context,{} as any),error);assert.deepEqual(f.calls,[]);});
test('server counter allocation precedes separate create and later effects',async()=>{const f=fixture('',false);await remove(f)(null,args,f.context,{} as any);assert.deepEqual(f.calls,['target','issue','number','session-close','create','activity','close','notify','image']);});
for(const failure of ['number','create'])test('retains '+failure+' creation failure contract',async()=>{const f=fixture(failure,false);await assert.rejects(remove(f)(null,args,f.context,{} as any),{message:failure==='number'?'failed number':'Error creating issue: failed create'});assert.ok(!f.calls.includes('activity'));});
test('flag-only removal retains timestamp/mod/issue link and never calls native storage',async()=>{const f=fixture();let update:any;let where:any;f.repository.findIssue=async(value:any)=>{where=value;return[f.issue];};f.repository.updateModerationState=async(_where:any,value:any)=>{update=value;return{images:[{id:'c'}]};};await remove(f)(null,args,f.context,{} as any);assert.deepEqual(where,{relatedImageId:'c',channelUniqueName:null});assert.equal(update.permanentlyRemoved,true);assert.ok(Number.isFinite(Date.parse(update.permanentlyRemovedAt)));assert.deepEqual(update.PermanentlyRemovedByMod,{connect:{where:{node:{displayName:'mod'}}}});assert.deepEqual(update.RelatedIssues,[{connect:[{where:{node:{id:'i'}}}]}]);});
