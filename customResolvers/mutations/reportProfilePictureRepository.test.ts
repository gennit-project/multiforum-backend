import assert from 'node:assert/strict';
import test from 'node:test';
import reportProfilePicture from './reportProfilePicture.js';
import type {ProfilePictureReportRepository} from '../../services/persistence/profilePictureReportRepository.js';
const args={username:'owner',reportText:'reason',selectedServerRules:['rule']};
const context=()=>({user:{username:'mod',email:null,email_verified:true,data:{ModerationProfile:{displayName:'Moderator'}}}} as never);
function fixture(options:{existing?:boolean;fail?:string;missing?:string}={}) {
 const calls:string[]=[];const values:Record<string,any>={};const enter=(name:string)=>{calls.push(name);if(options.fail===name)throw new Error(name+' failure');};
 const repository:ProfilePictureReportRepository={
  async findReportedProfile(username){enter('profile');values.username=username;return options.missing==='profile'?[]:[{username:'owner',displayName:'Owner Name',profilePicURL:options.missing==='picture'?null:'https://example.test/pic.png'}];},
  async findPriorProfileReport(username){enter('prior');values.prior=username;return options.existing?[{id:'issue',issueNumber:2,flaggedServerRuleViolation:false}]:[];},
  async createProfileReportIssue(input){enter('create');values.create=input;return {issues:options.missing==='create'?[]:[{id:'issue',issueNumber:7}]};},
  async appendProfileReport(params){enter('append');values.update=params;return {issues:options.missing==='append'?[]:[{id:'issue',issueNumber:7,relatedProfilePicUserId:'owner'}]};},
 };
 const driver={session:()=>{enter('session');return{executeWrite:async(fn:any)=>{enter('counter');return fn({run:async()=>({records:[{get:()=>7}]})});},close:async()=>enter('close')};}};
 return {calls,values,resolver:reportProfilePicture({driver:driver as never,profilePictureReportRepository:repository})};
}
test('profile report validation and moderator guard precede persistence',async()=>{for(const input of [{...args,username:''},{...args,selectedServerRules:[]}]){const f=fixture();await assert.rejects(f.resolver(null,input,context(),{} as never));assert.deepEqual(f.calls,[]);}const f=fixture();await assert.rejects(f.resolver(null,args,{user:{username:'u',data:{}}} as never,{} as never),/not a moderator/);assert.deepEqual(f.calls,[]);});
test('profile report checks picture before prior lookup and targets owner identity',async()=>{for(const missing of ['profile','picture']){const f=fixture({missing});await assert.rejects(f.resolver(null,args,context(),{} as never));assert.deepEqual(f.calls,['profile']);}const f=fixture();await f.resolver(null,args,context(),{} as never);assert.deepEqual(f.calls,['profile','prior','session','counter','close','create','append']);assert.equal(f.values.create.relatedProfilePicUserId,'owner');assert.equal(f.values.create.relatedUsername,'owner');assert.equal(f.values.create.title,'[Reported profile picture] Owner Name');assert.equal(f.values.create.channelUniqueName,null);assert.equal(f.values.create.issueNumber,7);});
test('existing profile issue skips allocation, reopens and always flags server rules',async()=>{const f=fixture({existing:true});await f.resolver(null,args,context(),{} as never);assert.deepEqual(f.calls,['profile','prior','append']);assert.equal(f.values.update.isOpen,true);assert.equal(f.values.update.flaggedServerRuleViolation,true);});
test('profile lookup and allocation errors remain outside create catch',async()=>{for(const fail of ['profile','prior','counter','close']){const f=fixture({fail});await assert.rejects(f.resolver(null,args,context(),{} as never),e=>(e as Error).message===fail+' failure');assert.ok(!f.calls.includes('create'));}});
test('profile creation includes error cause while append failure is generic',async()=>{for(const missing of [false,true]){let f=fixture(missing?{missing:'create'}:{fail:'create'});await assert.rejects(f.resolver(null,args,context(),{} as never),missing?/Error creating issue: Error creating issue/:/Error creating issue: create failure/);assert.ok(!f.calls.includes('append'));f=fixture(missing?{missing:'append'}:{fail:'append'});await assert.rejects(f.resolver(null,args,context(),{} as never),e=>(e as Error).message==='Error updating issue');}});
