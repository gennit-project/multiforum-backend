import assert from 'node:assert/strict';
import {test} from 'node:test';
import {commentVersionHistoryHandler} from './commentVersionHistoryHook.js';
import middleware from '../middleware/commentVersionHistoryMiddleware.js';
const snapshot=(extra:any={})=>({id:'c',text:'old',CommentAuthor:{username:'author'},DiscussionChannel:{channelUniqueName:'forum',discussionId:'d',Discussion:{title:'Discussion'}},...extra});
function setup(options:any={}) {
 const calls:any[]=[];
 const step=async(name:string,value:any,args?:any)=>{calls.push([name,args]);if(options.fail===name)throw Error(name+' failed');return value;};
 const commentRevisionRepository:any={
  findSnapshot:()=>step('snapshot',options.missing?[]:[snapshot(options.snapshot)]),
  findEditor:(username:string)=>step('editor',options.noEditor?[]:[{username}],username),
  createPreviousText:(input:any)=>step('create',options.emptyVersion?{textVersions:[]}:{textVersions:[{id:'v'}]},input),
  findCommentIds:()=>step('exists',options.missingTarget?[]:[{id:'c'}]),
  connectPreviousText:(...args:any[])=>step('connect',undefined,args),
 };
 const context:any={driver:{},user:{username:'editor',data:{ModerationProfile:{displayName:'Moderator'}}},commentRevisionRepository,
 notificationWriter:{createForUser:(input:any)=>step('notify',true,input)},
 issueActivityRepository:{findRelatedIssueIds:(where:any)=>step('issues',[],where)},
 };
 const run=(params:any={where:{id:'c'},update:{text:'new'}},commentSnapshot:any=undefined)=>commentVersionHistoryHandler({context,params,commentSnapshot});
 return {calls,context,run};
}
test('hook preserves old text, editor association, timestamp connection then author notification and issue lookup',async()=>{
 const s=setup();await s.run();assert.deepEqual(s.calls.map(c=>c[0]),['snapshot','editor','create','exists','connect','notify','issues']);
 assert.deepEqual(s.calls[2][1],{body:'old',Author:{connect:{where:{node:{username:'editor'}}}}});assert.equal(s.calls[4][1][0],'c');assert.equal(s.calls[4][1][1],'v');assert.ok(!Number.isNaN(Date.parse(s.calls[4][1][2])));assert.equal(s.calls[5][1].username,'author');assert.match(s.calls[5][1].text,/Moderator edited your comment/);
});
test('supplied snapshot skips read; equal text and missing author skip remaining operations',async()=>{
 const s=setup();await s.run({where:{id:'c'},update:{text:'old'}},snapshot());assert.deepEqual(s.calls,[]);
 await s.run(undefined,snapshot({CommentAuthor:null}));assert.deepEqual(s.calls,[]);
});
test('absent ID, update or text skip all dependencies',async()=>{const s=setup();for(const params of [{},{where:{id:'c'}},{where:{id:'c'},update:{}},{where:{},update:{text:'new'}}])await s.run(params);assert.deepEqual(s.calls,[]);});
test('snapshot errors swallowed before effects and missing comments stop',async()=>{for(const options of [{fail:'snapshot'},{missing:true}]){const s=setup(options);await s.run();assert.deepEqual(s.calls.map(c=>c[0]),['snapshot']);}});
test('inner history failures still allow author notification and related issue lookup',async()=>{
 for(const fail of ['editor','create','exists','connect']){const s=setup({fail});await s.run();assert.deepEqual(s.calls.slice(-2).map(c=>c[0]),['notify','issues']);assert.equal(s.calls.filter(c=>c[0]===fail).length,1);}
});
test('missing editor permits unattributed creation; missing version/target still permit later effects',async()=>{
 const s=setup({noEditor:true});await s.run();assert.deepEqual(s.calls.find(c=>c[0]==='create')[1],{body:'old'});
 for(const options of [{emptyVersion:true},{missingTarget:true}]){const x=setup(options);await x.run();assert.ok(!x.calls.some(c=>c[0]==='connect'));assert.deepEqual(x.calls.slice(-2).map(c=>c[0]),['notify','issues']);}
});
test('empty prior text skips revision but preserves notification/activity; null next text still archives prior text',async()=>{
 const s=setup({snapshot:{text:''}});await s.run();assert.deepEqual(s.calls.map(c=>c[0]),['snapshot','notify','issues']);
 const x=setup();await x.run({where:{id:'c'},update:{text:null}});assert.equal(x.calls.find(c=>c[0]==='create')[1].body,'old');
});
test('moderation author fallback is notification recipient only, not implicit revision editor',async()=>{
 const s=setup({snapshot:{CommentAuthor:{displayName:'ModAuthor',User:{username:'owner'}}}});s.context.user={};await s.run();assert.ok(!s.calls.some(c=>c[0]==='editor'));assert.deepEqual(s.calls.find(c=>c[0]==='create')[1],{body:'old'});assert.ok(!s.calls.some(c=>c[0]==='notify'));
});
test('middleware snapshot failure blocks resolver; resolver failure prevents history',async()=>{
 const s=setup({fail:'snapshot'});let calls=0;const resolve=async()=>{calls++;throw Error('resolver failed');};const args={where:{id:'c'},update:{text:'new'}};
 await assert.rejects(middleware.Mutation.updateComments(resolve,null,args,s.context,{} as any),/snapshot failed/);assert.equal(calls,0);
 const x=setup();await assert.rejects(middleware.Mutation.updateComments(resolve,null,args,x.context,{} as any),/resolver failed/);assert.deepEqual(x.calls.map(c=>c[0]),['snapshot']);assert.equal(calls,1);
});
test('middleware missing snapshot refetches only after successful resolver',async()=>{
 const s=setup({missing:true});await middleware.Mutation.updateComments(async()=>{s.calls.push(['resolve']);return {};},null,{where:{id:'c'},update:{text:'new'}},s.context,{} as any);assert.deepEqual(s.calls.map(c=>c[0]),['snapshot','resolve','snapshot']);
});
test('revision and author notification precede issue activity with comment reference, without implicit deduplication',async()=>{
 const s=setup();s.context.driver=undefined;
 s.context.issueActivityRepository={findRelatedIssueIds:async()=>{s.calls.push(['issues']);return [{id:'issue'}];},appendActivity:async(id:string,node:any)=>{s.calls.push(['activity',{id,node}]);}};
 await s.run();await s.run();assert.equal(s.calls.filter(c=>c[0]==='create').length,2);assert.equal(s.calls.filter(c=>c[0]==='activity').length,2);
 assert.deepEqual(s.calls.slice(0,8).map(c=>c[0]),['snapshot','editor','create','exists','connect','notify','issues','activity']);const activity=s.calls.find(c=>c[0]==='activity')[1];assert.equal(activity.id,'issue');assert.equal(activity.node.actionType,'edit');assert.deepEqual(activity.node.Comment,{connect:{where:{node:{id:'c'}}}});
});
test('moderation profile author recipient and event fallback keep editor identity distinct',async()=>{
 const s=setup({snapshot:{CommentAuthor:{displayName:'ModAuthor',User:{username:'owner'}},DiscussionChannel:null,Event:{id:'event',title:'Event',EventChannels:[{channelUniqueName:'forum'}]}}});await s.run();const notification=s.calls.find(c=>c[0]==='notify')[1];assert.equal(notification.username,'owner');assert.match(notification.text,/events\/event\/comments\/c/);assert.equal(s.calls.find(c=>c[0]==='editor')[1],'editor');
});
