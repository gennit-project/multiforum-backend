import assert from 'node:assert/strict';
import {test,before,after,afterEach,mock} from 'node:test';
import http from 'node:http';
import https from 'node:https';
import archive from './archiveComment.js';
import unarchive from './unarchiveComment.js';
let attempts=0;let guards:ReturnType<typeof mock.method>[]=[];
before(()=>{const deny=()=>{attempts++;throw Error('Unexpected external IO');};guards=[mock.method(globalThis,'fetch',deny),mock.method(http,'request',deny),mock.method(http,'get',deny),mock.method(https,'request',deny),mock.method(https,'get',deny)];});
afterEach(()=>assert.equal(attempts,0));after(()=>guards.forEach(g=>g.mock.restore()));
function fixture(fail='',existing=true){
 const calls:string[]=[];const issue={id:'i',issueNumber:7,flaggedServerRuleViolation:true};
 const step=async(name:string,result:any)=>{calls.push(name);if(name===fail)throw Error('failed '+name);return result;};
 const target=[{id:'c',text:'text',Channel:{uniqueName:'forum'}}];
 // appendIssueAction takes a single params object (AppendModerationActionsParams);
 // the archive action omits isOpen ('activity'), the close action sets isOpen:false ('close').
 const repository:any={findArchiveTarget:()=>step('target',target),findUnarchiveTarget:()=>step('target',target),findIssue:()=>step('issue',existing?[issue]:[]),createArchiveIssue:()=>step('create',{issues:[issue]}),appendIssueAction:(params:any)=>step(params.isOpen===false?'close':'activity',{issues:[issue]}),setArchived:()=>step('comment',{comments:[{id:'c'}]})};
 const driver:any={session:()=>({executeWrite:()=>step('number',{records:[{get:()=>7}]}),close:async()=>{calls.push('session-close');}})};
 const context:any={driver,user:{username:'mod-user',data:{ModerationProfile:{displayName:'mod'}}},notificationSnapshotRepository:{findIssueSubscribers:()=>step('notify',[])}};
 return {calls,repository,driver,context,issue};
}
const args={commentId:'c',selectedForumRules:['rule'],selectedServerRules:[],reportText:'report',explanation:'reason'};
for(const [name,factory] of [['archive',archive],['unarchive',unarchive]] as const){
 test(name+' preserves write and subscriber ordering',async()=>{const f=fixture();assert.deepEqual(await factory(f)(null,args,f.context,{} as any),f.issue);assert.deepEqual(f.calls,['target','issue','activity','close','notify','comment']);});
 for(const [failure,expected] of [['target','failed target'],['issue','failed issue'],['activity','Error updating issue'],['close','Error updating issue'],['notify','Error updating issue'],['comment','Error updating comment']])test(name+' preserves '+failure+' failure boundary',async()=>{const f=fixture(failure);await assert.rejects(factory(f)(null,args,f.context,{} as any),{message:expected});assert.equal(f.calls[f.calls.length-1],failure);});
 test(name+' validates before persistence',async()=>{const f=fixture();await assert.rejects(factory(f)(null,{...args,commentId:''},f.context,{} as any),/Comment ID is required/);assert.deepEqual(f.calls,[]);});
 test(name+' rejects nonmoderator before persistence',async()=>{const f=fixture();f.context.user.data={};await assert.rejects(factory(f)(null,args,f.context,{} as any),/is not a moderator/);assert.deepEqual(f.calls,[]);});
 test(name+' rejects missing forum before issue lookup',async()=>{const f=fixture();f.repository.findArchiveTarget=f.repository.findUnarchiveTarget=async()=>[];await assert.rejects(factory(f)(null,args,f.context,{} as any),/Could not find the forum/);assert.deepEqual(f.calls,[]);});
}
test('archive allocates number within creation catch and retains separate commits',async()=>{const f=fixture('',false);await archive(f)(null,args,f.context,{} as any);assert.deepEqual(f.calls,['target','issue','number','session-close','create','activity','close','notify','comment']);});
for(const failure of ['number','create'])test('archive wraps '+failure+' failure before later writes',async()=>{const f=fixture(failure,false);await assert.rejects(archive(f)(null,args,f.context,{} as any),new RegExp('Failed to create issue for archived comment: failed '+failure));assert.ok(!f.calls.includes('activity'));});
test('unarchive missing issue does not create one',async()=>{const f=fixture('',false);await assert.rejects(unarchive(f)(null,args,f.context,{} as any),/Issue not found/);assert.deepEqual(f.calls,['target','issue']);});
test('archive requires selected rule before identity/persistence',async()=>{const f=fixture();await assert.rejects(archive(f)(null,{...args,selectedForumRules:[]},f.context,{} as any),/At least one rule/);assert.deepEqual(f.calls,[]);});
test('archive comment-write failure prevents author notification after issue effects',async()=>{const f=fixture('comment');f.repository.findArchiveTarget=async()=>[{id:'c',text:'text',CommentAuthor:{__typename:'User',username:'author'},Channel:{uniqueName:'forum'},DiscussionChannel:{discussionId:'d'}}];f.context.notificationSnapshotRepository.findArchivedAuthor=async()=>{f.calls.push('author');return[{username:'author'}];};await assert.rejects(archive(f)(null,args,f.context,{} as any),/Error updating comment/);assert.deepEqual(f.calls,['issue','activity','close','notify','comment']);});
test('archive author notification failure is swallowed after all writes',async()=>{const f=fixture();f.repository.findArchiveTarget=async()=>[{id:'c',text:'text',CommentAuthor:{__typename:'User',username:'author'},Channel:{uniqueName:'forum'},DiscussionChannel:{discussionId:'d'}}];f.context.notificationSnapshotRepository.findArchivedAuthor=async()=>{f.calls.push('author');throw Error('author snapshot failure');};assert.deepEqual(await archive(f)(null,args,f.context,{} as any),f.issue);assert.deepEqual(f.calls,['issue','activity','close','notify','comment','author']);});
for(const [name,factory] of [['archive',archive],['unarchive',unarchive]] as const){
 test(name+' denies anonymous requests before persistence',async()=>{const f=fixture();f.context.user=null;await assert.rejects(factory(f)(null,args,f.context,{} as any),/User must be logged in/);assert.deepEqual(f.calls,[]);});
 test(name+' empty close result stops before subscriber and comment effects',async()=>{const f=fixture();f.repository.appendIssueAction=async(params:any)=>{f.calls.push(params.isOpen===false?'close':'activity');return{issues:[]};};await assert.rejects(factory(f)(null,args,f.context,{} as any),/Error updating issue/);assert.deepEqual(f.calls,['target','issue','activity','close']);});
}
