import assert from 'node:assert/strict';
import {test} from 'node:test';
import {eventVersionHistoryHandler} from './eventVersionHistoryHook.js';
import middleware from '../middleware/eventVersionHistoryMiddleware.js';
const snapshot=(extra:any={})=>({id:'e',title:'old title',description:'old description',Poster:{username:'poster'},DescriptionLastEditedBy:{username:'prior'},EventChannels:[{channelUniqueName:'forum'}],...extra});
function setup(options:any={}) {
 const calls:any[]=[];let nextId=0;
 const step=async(name:string,value:any,args?:any)=>{calls.push([name,args]);if(options.fail===name)throw Error(name+' failed');return value;};
 const eventRevisionRepository:any={
  findSnapshot:()=>step('snapshot',options.missing?[]:[snapshot(options.snapshot)]),
  findVersionAuthor:(username:string)=>step('author',options.noAuthor?[]:[{username}],username),
  createPreviousText:(...args:any[])=>step('create',options.empty?{textVersions:[]}:{textVersions:[{id:`v${++nextId}`}]},args),
  connectTitleVersion:(...args:any[])=>step('title',undefined,args),
  connectDescriptionVersion:(...args:any[])=>step('description',undefined,args),
  replaceDescriptionEditor:(...args:any[])=>step('editor',undefined,args),
 };
 const context:any={eventRevisionRepository,user:{username:'editor'},notificationWriter:{createForUser:(input:any)=>step('notify',true,input)},issueActivityRepository:{findRelatedIssueIds:()=>step('issues',[{id:'issue'}]),appendActivity:(...args:any[])=>step('activity',undefined,args)}};
 const run=(update:any={title:'new title',description:'new description'},eventSnapshot:any=snapshot(options.snapshot))=>eventVersionHistoryHandler({context,params:{where:{id:'e'},update},eventSnapshot});
 const through=(resolve:any=async()=>{calls.push(['resolve']);return 'result';},update:any={title:'new title',description:'new description'})=>middleware.Mutation.updateEvents(resolve,null,{where:{id:'e'},update},context,{} as any);
 return {calls,context,run,through};
}
test('title then description use distinct authors, then editor replacement and ordered revision activities',async()=>{const s=setup();await s.run();assert.deepEqual(s.calls.map(c=>c[0]),['author','create','title','author','create','description','editor','issues','activity','activity']);assert.deepEqual(s.calls.filter(c=>c[0]==='create').map(c=>c[1]),[['old title','editor'],['old description','prior']]);const activities=s.calls.filter(c=>c[0]==='activity').map(c=>c[1][1]);assert.deepEqual(activities.map(a=>a.actionDescription),['edited the event title','edited the event description']);assert.deepEqual(activities.map(a=>a.Revision.connect.where.node.id),['v1','v2']);});
test('history precedes underlying resolver; author notification follows only successful resolver',async()=>{const s=setup();assert.equal(await s.through(),'result');const names=s.calls.map(c=>c[0]);assert.equal(names[0],'snapshot');assert.ok(names.indexOf('activity')<names.indexOf('resolve'));assert.equal(names[names.length-1],'notify');const x=setup();await assert.rejects(x.through(async()=>{x.calls.push(['resolve']);throw Error('auth denied');}),/auth denied/);assert.ok(x.calls.some(c=>c[0]==='title'));assert.ok(!x.calls.some(c=>c[0]==='notify'));});
test('snapshot read error prevents resolver; missing snapshot skips history but still resolves',async()=>{const s=setup({fail:'snapshot'});await assert.rejects(s.through(),/snapshot failed/);assert.deepEqual(s.calls.map(c=>c[0]),['snapshot']);const x=setup({missing:true});await x.through();assert.deepEqual(x.calls.map(c=>c[0]),['snapshot','resolve']);});
test('title connection failure does not block description; editor replacement failure suppresses all activity',async()=>{const s=setup({fail:'title'});await s.run();assert.ok(s.calls.some(c=>c[0]==='description'));assert.equal(s.calls.filter(c=>c[0]==='activity').length,1);const x=setup({fail:'editor'});await x.run();assert.ok(x.calls.some(c=>c[0]==='description'));assert.ok(!x.calls.some(c=>c[0]==='issues'));});
test('description connection or missing-author failure still replaces editor',async()=>{for(const options of [{fail:'description'},{noAuthor:true},{empty:true}]){const s=setup(options);await s.run({description:'new'});assert.equal(s.calls[s.calls.length-1][0],'editor');assert.ok(!s.calls.some(c=>c[0]==='activity'));}});
test('null prior text becomes empty; editor/poster and prior-description fallback remain distinct',async()=>{const s=setup({snapshot:{title:null,description:null,DescriptionLastEditedBy:null}});s.context.user={};await s.run();assert.deepEqual(s.calls.filter(c=>c[0]==='create').map(c=>c[1]),[['','poster'],['','poster']]);assert.ok(!s.calls.some(c=>c[0]==='editor'));const x=setup({snapshot:{Poster:null,DescriptionLastEditedBy:null}});await x.run({description:'new'});assert.equal(x.calls[0][1],'[Unknown]');});
test('missing title editor aborts description too even if prior description author exists',async()=>{const s=setup({snapshot:{Poster:null}});s.context.user={};await s.run({description:'new'});assert.deepEqual(s.calls,[]);});
test('equal fields skip history but middleware still notifies on their presence',async()=>{const s=setup();await s.through(undefined,{title:'old title',description:'old description'});assert.deepEqual(s.calls.map(c=>c[0]),['snapshot','resolve','notify']);});
test('fallback snapshot is read only when initial optional snapshot comparison marks fields changed',async()=>{const s=setup();await s.run({title:'old title'},null);assert.deepEqual(s.calls.map(c=>c[0]),['snapshot']);const x=setup();await x.run({},null);assert.deepEqual(x.calls,[]);});
test('repeated invocation does not add implicit deduplication',async()=>{const s=setup();await s.run({title:'new'});await s.run({title:'new'});assert.equal(s.calls.filter(c=>c[0]==='create').length,2);assert.equal(s.calls.filter(c=>c[0]==='activity').length,2);});
