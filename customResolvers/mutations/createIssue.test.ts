import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Driver } from 'neo4j-driver';
import createIssue from './createIssue.js';
import {createIssueWithTargetIdentity} from '../../middleware/issueIdentityMiddleware.js';

const valid = () => ({channelUniqueName:'forum',issueNumber:99,authorName:'alice',relatedUsername:'alice',Author:{User:{connect:{where:{node:{username:'alice'}}}}}});
function fixture(options: {allocationError?: Error; closeError?: Error; result?: unknown; createError?: Error} = {}) {
 const calls: string[]=[]; let captured: any;
 const driver={session:()=>{calls.push('session');return {executeWrite:async(fn:any)=>{calls.push('write');if(options.allocationError)throw options.allocationError;return fn({run:async()=>({records:[{get:()=>7}]})});},close:async()=>{calls.push('close');if(options.closeError)throw options.closeError;}};}} as unknown as Driver;
 const resolver=createIssue({driver,issueCreationRepository:{create:async input=>{calls.push('create');captured=input;if(options.createError)throw options.createError;return (Object.prototype.hasOwnProperty.call(options,'result')?options.result:{id:'i',issueNumber:7}) as any;}}});
 return {calls,resolver,get captured(){return captured;}};
}
test('allocation closes before identity attachment and creation, replacing supplied number',async()=>{
 const f=fixture();assert.deepEqual(await f.resolver(null,{input:valid() as any}),{id:'i',issueNumber:7});
 assert.deepEqual(f.calls,['session','write','close','create']);assert.equal(f.captured.issueNumber,7);
 assert.deepEqual(f.captured.Channel,{connect:{where:{node:{uniqueName:'forum'}}}});
 assert.deepEqual(f.captured.TargetUser,{connect:{where:{node:{username:'alice'}}}});
});
test('missing channel fails before allocating',async()=>{const f=fixture();await assert.rejects(f.resolver(null,{input:{...valid(),channelUniqueName:null} as any}),/channelUniqueName is required/);assert.deepEqual(f.calls,[]);});
test('allocation and close failures retain original errors outside creation catch',async()=>{
 for(const key of ['allocationError','closeError'] as const){const error=new Error(key);const f=fixture({[key]:error});await assert.rejects(f.resolver(null,{input:valid() as any}),e=>e===error);assert.deepEqual(f.calls,['session','write','close']);}
});
test('identity rejection happens after allocation and before schema write',async()=>{const f=fixture();await assert.rejects(f.resolver(null,{input:{...valid(),authorName:'other'} as any}),/^Error creating issue$/);assert.deepEqual(f.calls,['session','write','close']);});
test('creation failures and missing IDs retain generic error',async()=>{for(const options of [{createError:new Error('database')},{result:undefined},{result:{issueNumber:7}}]){const f=fixture(options);await assert.rejects(f.resolver(null,{input:valid() as any}),/^Error creating issue$/);assert.deepEqual(f.calls,['session','write','close','create']);}});

test('public middleware rejects the supplied invalid number before allocation and accepts valid numbers before override',async()=>{
 const f=fixture();
 const call=(value:any)=>createIssueWithTargetIdentity(f.resolver as never,null,{input:value},{} as never,{} as never);
 await assert.rejects(call({...valid(),issueNumber:-1}),/non-negative integer/);assert.deepEqual(f.calls,[]);
 assert.deepEqual(await call(valid()),{id:'i',issueNumber:7});assert.equal(f.captured.issueNumber,7);
 assert.deepEqual(f.captured.TargetUser,{connect:{where:{node:{username:'alice'}}}});
});
