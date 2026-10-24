import assert from 'node:assert/strict';
import test from 'node:test';
import reportImage from './reportImage.js';
import type {ImageReportRepository} from '../../services/persistence/imageReportRepository.js';
const args={imageId:'img',reportText:'reason',selectedForumRules:[],selectedServerRules:['rule'],channelUniqueName:null};
const context=()=>({user:{username:'mod',email:null,email_verified:true,data:{ModerationProfile:{displayName:'Moderator'}}}} as never);
function fixture(options:{existing?:boolean;fail?:string;missing?:string}={}) {
 const calls:string[]=[];const values:Record<string,any>={};
 const enter=(name:string)=>{calls.push(name);if(options.fail===name)throw new Error(name+' failure');};
 const repository:ImageReportRepository={
  async findReportedImage(id){enter('image');values.image=id;return options.missing==='image'?[]:[{id:'img',url:'https://example.test/a-long-image-filename.png',Uploader:{username:'owner'}}];},
  async findPriorImageReport(where){enter('prior');values.where=where;return options.existing?[{id:'issue',issueNumber:2,flaggedServerRuleViolation:true,relatedUsername:'prior-owner'}]:[];},
  async createImageReportIssue(input){enter('create');values.create=input;return {issues:options.missing==='create'?[]:[{id:'issue',issueNumber:7}]};},
  async appendImageReport(params){enter('append');values.update=params;return {issues:options.missing==='append'?[]:[{id:'issue',issueNumber:7,relatedImageId:'img'}]};},
 };
 const driver={session:()=>{enter('session');return{executeWrite:async(fn:any)=>{enter('counter');return fn({run:async()=>({records:[{get:()=>7}]})});},close:async()=>enter('close')};}};
 return {calls,values,resolver:reportImage({driver:driver as never,imageReportRepository:repository})};
}
test('image report validates before reading and requires authenticated moderator',async()=>{
 for(const input of [{...args,imageId:''},{...args,selectedServerRules:[]},{...args,selectedServerRules:[],selectedForumRules:['forum']}]){const f=fixture();await assert.rejects(f.resolver(null,input,context(),{} as never));assert.deepEqual(f.calls,[]);}
 const f=fixture();await assert.rejects(f.resolver(null,args,{user:{username:'u',data:{}}} as never,{} as never),/not a moderator/);assert.deepEqual(f.calls,[]);
});
test('new image report closes separate counter before creation and then appends activity',async()=>{
 const f=fixture();await f.resolver(null,args,context(),{} as never);assert.deepEqual(f.calls,['image','prior','session','counter','close','create','append']);assert.deepEqual(f.values.where,{relatedImageId:{eq:'img'},channelUniqueName:{eq:null}});assert.equal(f.values.create.relatedUsername,'owner');assert.equal(f.values.create.issueNumber,7);assert.equal(f.values.create.title,'[Reported image] https://example.test/a-long-im...');assert.equal(f.values.update.isOpen,true);
});
test('forum report uses scoped lookup and channel connection; existing report skips counter and creation',async()=>{
 const f=fixture({existing:true});await f.resolver(null,{...args,channelUniqueName:'forum',selectedServerRules:[],selectedForumRules:['f']},context(),{} as never);assert.deepEqual(f.calls,['image','prior','append']);assert.deepEqual(f.values.where,{relatedImageId:{eq:'img'},channelUniqueName:{eq:'forum'}});assert.equal(f.values.update.flaggedServerRuleViolation,true);assert.equal(f.values.update.actions[0].commentChannelUniqueName,'forum');
});
test('lookup and allocation failures remain outside the creation catch',async()=>{
 for(const fail of ['image','prior','counter','close']){const f=fixture({fail});await assert.rejects(f.resolver(null,args,context(),{} as never),e=>(e as Error).message===fail+' failure');assert.ok(!f.calls.includes('create'));}
 const f=fixture({missing:'image'});await assert.rejects(f.resolver(null,args,context(),{} as never),/Image not found/);assert.deepEqual(f.calls,['image']);
});
test('creation errors retain causes and append errors hide causes',async()=>{
 for(const missing of [false,true]){let f=fixture(missing?{missing:'create'}:{fail:'create'});await assert.rejects(f.resolver(null,args,context(),{} as never),missing?/Error creating issue: Error creating issue/:/Error creating issue: create failure/);assert.ok(!f.calls.includes('append'));
 f=fixture(missing?{missing:'append'}:{fail:'append'});await assert.rejects(f.resolver(null,args,context(),{} as never),e=>(e as Error).message==='Error updating issue');assert.ok(f.calls.includes('create'));}
});
