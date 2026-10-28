import assert from 'node:assert/strict';
import test from 'node:test';
import getResolver from './updateDownloadLabels.js';
import type {DownloadLabelRepository} from '../../services/persistence/downloadLabelRepository.js';
function fixture({historyFailure=false,moderator=false,writeFailure=false}={}){
 const calls:string[]=[];const history:any[]=[];const actions:any[]=[];
 const repository:DownloadLabelRepository={
  findDiscussion:async()=>{calls.push('discussion');return [{id:'d',title:'Download',Author:{username:'owner'}}] as any;},
  findChannel:async()=>{calls.push('channel');return [{id:'dc',LabelOptions:[{id:'old',value:'old',displayName:null}]}] as any;},
  findOptions:async()=>{calls.push('options');return [{id:'new',value:'new',displayName:'New'}] as any;},
  updateLabels:async(_id,update)=>{calls.push('update');assert.deepEqual(update,{LabelOptions:[{connect:[{where:{node:{id:{eq:'new'}}}}]},{disconnect:[{where:{node:{id:{eq:'old'}}}}]}]});if(writeFailure)throw Error('write failure');return {discussionChannels:[{id:'dc'}] as any};},
  createHistory:async input=>{calls.push('history:'+input[0].actionType);history.push(input[0]);if(historyFailure)throw Error('history failure');},
  createModerationAction:async input=>{calls.push('moderation');actions.push(input[0]);throw Error('moderation failure');},
 };
 const context={user:{username:moderator?'mod':'owner',data:{ModerationProfile:moderator?{displayName:'Moderator'}:null}},permissionServerConfigRepository:{findByName:async()=>({Admins:[{username:'mod'}]})}};
 return {calls,history,actions,repository,context,resolver:getResolver({driver:{} as never,downloadLabelRepository:repository})};
}
for(const historyFailure of [false,true])test(`owner history is added then removed; failure stops remaining history=${historyFailure}`,async()=>{
 const f=fixture({historyFailure});assert.deepEqual(await f.resolver(null,{discussionId:'d',channelUniqueName:'c',labelOptionIds:['new']},f.context as never,{} as never),{id:'dc'});
 assert.deepEqual(f.calls,['discussion','channel','options','update','history:added',...(historyFailure?[]:['history:removed'])]);
 assert.deepEqual(f.history[0].ActorUser,{connect:{where:{node:{username:'owner'}}}});assert.equal(f.history[0].ActorMod,undefined);
 if(!historyFailure)assert.equal(f.history[1].labelDisplayName,'old');
});
test('moderation append proceeds after swallowed history failure and its own failure is swallowed',async()=>{
 const f=fixture({moderator:true,historyFailure:true});assert.deepEqual(await f.resolver(null,{discussionId:'d',channelUniqueName:'c',labelOptionIds:['new']},f.context as never,{} as never),{id:'dc'});
 assert.deepEqual(f.calls,['discussion','channel','options','update','history:added','moderation']);assert.deepEqual(f.history[0].ActorMod,{connect:{where:{node:{displayName:'Moderator'}}}});assert.equal(f.actions[0].actionDescription,'Updated download labels to: New on "Download"');
});
test('update failure prevents both history and moderation',async()=>{const f=fixture({moderator:true,writeFailure:true});await assert.rejects(f.resolver(null,{discussionId:'d',channelUniqueName:'c',labelOptionIds:['new']},f.context as never,{} as never),{message:'write failure'});assert.deepEqual(f.calls,['discussion','channel','options','update']);});
test('empty required identity and unauthenticated context fail before persistence',async()=>{const f=fixture();for(const args of [{discussionId:'',channelUniqueName:'c',labelOptionIds:[]},{discussionId:'d',channelUniqueName:'',labelOptionIds:[]},{discussionId:'d',channelUniqueName:'c',labelOptionIds:[]}])await assert.rejects(f.resolver(null,args,{} as never,{} as never));assert.deepEqual(f.calls,[]);});
test('missing discussion prevents all dependent reads and writes',async()=>{const f=fixture();f.repository.findDiscussion=async()=>[];await assert.rejects(f.resolver(null,{discussionId:'d',channelUniqueName:'c',labelOptionIds:[]},f.context as never,{} as never),{message:'Discussion not found'});assert.deepEqual(f.calls,[]);});
