import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Driver} from 'neo4j-driver';
import type {GraphQLResolveInfo} from 'graphql';
import type {GraphQLContext} from '../../types/context.js';
import undo from './undoSuperUpvote.js';
import type {SuperVoteUndoRepository} from '../../services/persistence/superVoteUndoRepository.js';
for(const sourceType of ['comment','discussion'] as const)for(const phase of ['success','not-voted','missing','read-error'] as const)test(`${sourceType} undo ordering ${phase}`,async()=>{
 const order:string[]=[];const error=new Error('lookup failure');
 const tx={run:async(query:string)=>{order.push(query.includes('RETURN collect')?'read-list':query.includes('DETACH DELETE')?'delete-entry':query.includes('SET a.')?'karma':'relationship');return {records:[{get:()=>[]}]};},commit:async()=>{order.push('commit');},rollback:async()=>{order.push('rollback');}};
 const driver={session:()=>{order.push('session');return {beginTransaction:()=>{order.push('begin');return tx;},close:async()=>{order.push('close');}};}} as unknown as Driver;
 const lookup=async()=>{order.push('snapshot');if(phase==='read-error')throw error;if(phase==='missing')return [];return [{id:'target',SuperUpvotedByUsers:phase==='not-voted'?[]:[{username:'voter'}],CommentAuthor:{username:'author'},Discussion:{Author:{username:'author'}}}] as any;};
 const repo:SuperVoteUndoRepository={findComment:lookup,findDiscussion:lookup};
 const invoke=()=>undo({driver,repository:repo})(null,{sourceType,sourceId:'target'},{user:{username:'voter'}} as GraphQLContext,{} as GraphQLResolveInfo);
 if(phase==='success'){assert.equal((await invoke()).success,true);assert.deepEqual(order,['session','begin','snapshot','relationship','karma','delete-entry','read-list','commit','close']);}
 else {await assert.rejects(invoke);assert.deepEqual(order,['session','begin','snapshot','rollback','close']);}
});
