import assert from 'node:assert/strict';
import test from 'node:test';
import {createBotReport} from './botReportService.js';
import type {BotReportRepository} from './persistence/botReportRepository.js';
function fixture(existing=true){const calls:string[]=[];const repo:BotReportRepository={
 findExistingReport:async()=>{calls.push('issue');return existing?[{id:'i',issueNumber:7,relatedUsername:'alice'}] as any:[];},
 findReportedComment:async()=>{calls.push('comment');return [{id:'c',text:'Context',CommentAuthor:{__typename:'User',username:'alice'}}] as any;},
 findReportedDiscussion:async()=>[],findReportedEvent:async()=>[],
 createReportedIssue:async()=>{calls.push('create');return {issues:[{id:'i',issueNumber:7}] as any};},
 appendBotReport:async(_where,update)=>{calls.push('append');assert.equal(update.isOpen,true);return {issues:[{id:'i',issueNumber:7}] as any};},
};const identity={findIdentity:async()=>{calls.push('identity');return [{username:'bot-forum-helper',isBot:true,botProfileId:null}] as any;},createIdentity:async()=>{throw Error('unexpected create');},reactivateIdentity:async()=>{throw Error('unexpected reactivate');},findChannelBots:async()=>{calls.push('membership');return [{uniqueName:'forum',Bots:[{username:'bot-forum-helper'}]}] as any;},connectBot:async()=>({channels:[]}),disconnectBots:async()=>({channels:[]})};
const driver={session:()=>({executeWrite:async()=>{calls.push('counter');return {records:[{get:()=>7}]};},close:async()=>{calls.push('close');}})} as any;
const args={contentType:'comment' as const,contentId:'c',reportText:'Review',selectedForumRules:['Rule'],selectedServerRules:[] as string[],botName:'helper'};
return {calls,repo,args,run:()=>createBotReport({driver,models:{} as never,botIdentityRepository:identity,botReportRepository:repo,channelUniqueName:'forum',reportInput:args})};}
test('validation precedes identity lookup; identity and membership precede content reads',async()=>{const f=fixture();f.args.contentId='';await assert.rejects(f.run(),/ID is required/);assert.equal(f.calls.length,0);f.args.contentId='c';await f.run();assert.deepEqual(f.calls,['identity','membership','issue','comment','append']);});
test('new issue sequence closes counter session before create and append',async()=>{const f=fixture(false);await f.run();assert.deepEqual(f.calls,['identity','membership','issue','comment','counter','close','create','append']);});
test('create failure keeps counter consumption and prevents append with original prefix',async()=>{const f=fixture(false);f.repo.createReportedIssue=async()=>{f.calls.push('create');throw Error('fixture');};await assert.rejects(f.run(),{message:'Error creating issue: fixture'});assert.deepEqual(f.calls,['identity','membership','issue','comment','counter','close','create']);});
test('repeated reports append separately without suppression',async()=>{const f=fixture();await f.run();await f.run();assert.equal(f.calls.filter(c=>c==='append').length,2);});
test('missing append result retains original error wrapping',async()=>{const f=fixture();f.repo.appendBotReport=async()=>({issues:[]});await assert.rejects(f.run(),{message:'Error updating issue: Error updating issue'});});
