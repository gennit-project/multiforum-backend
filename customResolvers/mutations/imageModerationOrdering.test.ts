import assert from 'node:assert/strict';
import {test,before,after,afterEach,mock} from 'node:test';
import http from 'node:http';
import https from 'node:https';
import {Storage} from '@google-cloud/storage';
import archive from './archiveImage.js';
import unarchive from './unarchiveImage.js';
let attempts=0;let guards:ReturnType<typeof mock.method>[]=[];
before(()=>{const deny=()=>{attempts++;throw Error('Unexpected external IO');};guards=[mock.method(Storage.prototype,'bucket',deny),mock.method(globalThis,'fetch',deny),mock.method(http,'request',deny),mock.method(http,'get',deny),mock.method(https,'request',deny),mock.method(https,'get',deny)];});
afterEach(()=>assert.equal(attempts,0));after(()=>guards.forEach(g=>g.mock.restore()));
function fixture(fail='',existing=true){
 const calls:string[]=[];const issue={id:'i',issueNumber:7,flaggedServerRuleViolation:true};
 const step=async(name:string,result:any)=>{calls.push(name);if(name===fail)throw Error('failed '+name);return result;};
 const target=[{id:'c',url:'https://example.invalid/image'}];
 const repository:any={findArchiveTarget:()=>step('target',target),findUnarchiveTarget:()=>step('target',target),findIssue:()=>step('issue',existing?[issue]:[]),createModerationIssue:()=>step('create',{issues:[issue]}),appendIssueAction:(params:any)=>step(params.isOpen===false?'close':'activity',{issues:[issue]}),updateModerationState:()=>step('image',{images:[{id:'c'}]})};
 const driver:any={session:()=>({executeWrite:()=>step('number',{records:[{get:()=>7}]}),close:async()=>{calls.push('session-close');}})};
 const context:any={driver,user:{username:'mod-user',data:{ModerationProfile:{displayName:'mod'}}},notificationSnapshotRepository:{findIssueSubscribers:()=>step('notify',[])}};
 return {calls,repository,driver,context,issue};
}
const args={imageId:'c',selectedForumRules:['rule'],selectedServerRules:[],reportText:'report',explanation:'reason',channelUniqueName:'forum'};
for(const [name,factory] of [['archive',archive],['unarchive',unarchive]] as const){
 test(name+' preserves write and subscriber ordering',async()=>{const f=fixture();assert.deepEqual(await factory(f)(null,args,f.context,{} as any),f.issue);assert.deepEqual(f.calls,['target','issue','activity','close','notify','image']);});
 for(const [failure,expected] of [['target','failed target'],['issue','failed issue'],['activity','Error updating issue'],['close','Error updating issue'],['notify','Error updating issue'],['image','Error updating image']])test(name+' preserves '+failure+' failure boundary',async()=>{const f=fixture(failure);await assert.rejects(factory(f)(null,args,f.context,{} as any),{message:expected});assert.equal(f.calls[f.calls.length-1],failure);});
 test(name+' validates before persistence',async()=>{const f=fixture();await assert.rejects(factory(f)(null,{...args,imageId:''},f.context,{} as any),/Image ID is required/);assert.deepEqual(f.calls,[]);});
 test(name+' rejects nonmoderator before persistence',async()=>{const f=fixture();f.context.user.data={};await assert.rejects(factory(f)(null,args,f.context,{} as any),/is not a moderator/);assert.deepEqual(f.calls,[]);});
 test(name+' rejects missing image before issue lookup',async()=>{const f=fixture();f.repository.findArchiveTarget=f.repository.findUnarchiveTarget=async()=>[];await assert.rejects(factory(f)(null,args,f.context,{} as any),/Image not found/);assert.deepEqual(f.calls,[]);});
}
test('archive allocates number outside creation catch and retains separate commits',async()=>{const f=fixture('',false);await archive(f)(null,args,f.context,{} as any);assert.deepEqual(f.calls,['target','issue','number','session-close','create','activity','close','notify','image']);});
for(const failure of ['number','create'])test('archive retains '+failure+' failure boundary',async()=>{const f=fixture(failure,false);await assert.rejects(archive(f)(null,args,f.context,{} as any),{message:failure==='number'?'failed number':'Error creating issue: failed create'});assert.ok(!f.calls.includes('activity'));});
test('unarchive missing issue does not create one',async()=>{const f=fixture('',false);await assert.rejects(unarchive(f)(null,args,f.context,{} as any),/Issue not found/);assert.deepEqual(f.calls,['target','issue']);});
test('archive requires selected rule before identity/persistence',async()=>{const f=fixture();await assert.rejects(archive(f)(null,{...args,selectedForumRules:[]},f.context,{} as any),/At least one rule/);assert.deepEqual(f.calls,[]);});

test('server archive requires server rule before persistence',async()=>{const f=fixture();await assert.rejects(archive(f)(null,{...args,channelUniqueName:undefined},f.context,{} as any),/At least one server rule/);assert.deepEqual(f.calls,[]);});
test('forum and server scopes use explicit where filters',async()=>{for(const channelUniqueName of ['forum',undefined]){const f=fixture();let where:any;f.repository.findIssue=async(value:any)=>{where=value;return[f.issue];};await archive(f)(null,{...args,channelUniqueName,selectedServerRules:['server']},f.context,{} as any);assert.deepEqual(where,{relatedImageId:{eq:'c'},channelUniqueName:{eq:channelUniqueName??null}});}});

for(const [name,factory] of [['archive',archive],['unarchive',unarchive]] as const){
 test(name+' denies anonymous before persistence',async()=>{const f=fixture();f.context.user=null;await assert.rejects(factory(f)(null,args,f.context,{} as any),/User must be logged in/);assert.deepEqual(f.calls,[]);});
 test(name+' empty close result stops before subscriber and image effects',async()=>{const f=fixture();f.repository.appendIssueAction=async(params:any)=>{f.calls.push(params.isOpen===false?'close':'activity');return{issues:[]};};await assert.rejects(factory(f)(null,args,f.context,{} as any),/Error updating issue/);assert.deepEqual(f.calls,['target','issue','activity','close']);});
}
test('archive image-write failure prevents author notification',async()=>{const f=fixture('image');f.repository.findArchiveTarget=async()=>[{id:'c',url:'url',Uploader:{username:'author'}}];f.context.notificationSnapshotRepository.findArchivedAuthor=async()=>{f.calls.push('author');return[{username:'author'}];};await assert.rejects(archive(f)(null,args,f.context,{} as any),/Error updating image/);assert.deepEqual(f.calls,['issue','activity','close','notify','image']);});
test('archive author notification failure is swallowed after writes',async()=>{const f=fixture();f.repository.findArchiveTarget=async()=>[{id:'c',url:'url',Uploader:{username:'author'}}];f.context.notificationSnapshotRepository.findArchivedAuthor=async()=>{f.calls.push('author');throw Error('author failure');};assert.deepEqual(await archive(f)(null,args,f.context,{} as any),f.issue);assert.deepEqual(f.calls,['issue','activity','close','notify','image','author']);});
