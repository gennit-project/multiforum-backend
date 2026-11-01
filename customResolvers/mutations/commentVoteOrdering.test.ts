import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Driver } from 'neo4j-driver';
import type { GraphQLContext } from '../../types/context.js';
import type { GraphQLResolveInfo } from 'graphql';
import upvote from './upvoteComment.js';
import undo from './undoUpvoteComment.js';
import type { CommentVoteRepository } from '../../services/persistence/commentVoteRepository.js';
for (const [name, factory] of [['upvote',upvote],['undo',undo]] as const) {
 for (const phase of ['success','read-failure','karma-failure','moderator'] as const) {
  test(`${name} preserves transaction ordering and ${phase} contract`,async()=>{
   const order:string[]=[]; const error=new Error('fixture failure');
   const tx={run:async()=>{order.push('raw');return {records:[{get:()=>({upvotedByUser:name==='undo'})}]};},commit:async()=>{order.push('commit');},rollback:async()=>{order.push('rollback');}};
   const driver={session:()=>{order.push('session');return {beginTransaction:()=>{order.push('begin');return tx;},close:()=>{order.push('close');}};}} as unknown as Driver;
   const repository:CommentVoteRepository={
    findComment:async()=>{order.push('comment');if(phase==='read-failure')throw error;return [{id:'c',CommentAuthor:phase==='moderator'?{displayName:'mod',createdAt:'2026-01-01T00:00:00Z'}:{username:'author',commentKarma:7,createdAt:'2026-01-01T00:00:00Z'},weightedVotesCount:4,UpvotedByUsers:[],UpvotedByUsersConnection:{aggregate:{count:{nodes:0}}}}];},
    findVoter:async()=>{order.push('voter');return [{username:'voter',commentKarma:0}];},
    setAuthorKarma:async(username,karma)=>{assert.equal(username,'author');assert.equal(karma,name==='undo'?6:8);order.push('karma');if(phase==='karma-failure')throw error;},
   };
   const invoke=()=>factory({driver,repository})(null,{commentId:'c',username:'voter'},{user:{username:'different'}} as GraphQLContext,{} as GraphQLResolveInfo);
   if(phase.endsWith('failure')&&name==='undo')await assert.rejects(invoke,error);
   else {const result=await invoke();assert.equal(Boolean(result),!phase.endsWith('failure'));}
   const expected=['session','begin','raw','comment'];
   if(phase!=='read-failure')expected.push('voter','raw',...(phase==='moderator'?[]:['karma']));
   expected.push(phase.endsWith('failure')?'rollback':'commit','close');assert.deepEqual(order,expected);
  });
 }
}
