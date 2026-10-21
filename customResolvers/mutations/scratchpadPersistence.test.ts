import assert from "node:assert/strict";
import test from "node:test";
import create from "./createScratchpadEntry.js";
import remove from "./deleteScratchpadEntry.js";
import visibility from "./updateScratchpadEntryVisibility.js";
const args={recipientUsername:"bob",text:"thanks",sourceType:"comment",sourceId:"source"};
const context={user:{username:"alice"}};
for(const sourceType of ["comment","discussion"] as const){
 for(const failureAt of ["recipient","source"]){
  test(`${sourceType} ${failureAt} failure retains begin/read/rollback/close ordering`,async()=>{
   const order:string[]=[];const error=new Error("read failed");
   const repository={findRecipient:async()=>{order.push("recipient");if(failureAt==="recipient")throw error;return[{username:"bob"}];},[sourceType==="comment"?"findCommentSource":"findDiscussionSource"]:async()=>{order.push("source");throw error;}};
   const driver={session:()=>{order.push("session");return{beginTransaction:()=>{order.push("begin");return{rollback:async()=>{order.push("rollback");},run:async()=>{order.push("unexpected-write");}};},close:async()=>{order.push("close");}};}};
   const resolver=create({driver,scratchpadRepository:repository} as never);
   await assert.rejects(resolver(null,{...args,sourceType},context as never,{} as never),e=>e===error);
   assert.deepEqual(order,["session","begin","recipient",...(failureAt==="source"?["source"]:[]),"rollback","close"]);
  });
 }
}
for(const [name,factory,read,write] of [["delete",remove,"findOwnership","deleteEntry"],["visibility",visibility,"findVisibility","updateVisibility"]] as const){
 test(`${name} checks auth/ownership before persistence and preserves return value`,async()=>{
  const order:unknown[]=[];let entry:any={id:"entry",Recipient:{username:"other"},text:"old",isPublic:false};
  const repository={[read]:async(id:string)=>{order.push(["read",id]);return entry?[entry]:[];},[write]:async(...values:unknown[])=>{order.push(["write",...values]);}};
  const resolver=factory({scratchpadRepository:repository} as never);const input={scratchpadEntryId:"entry",isPublic:true};
  await assert.rejects(resolver(null,input,{} as never,{} as never),/logged in/);assert.deepEqual(order,[]);
  await assert.rejects(resolver(null,input,context as never,{} as never),/Only the recipient/);assert.deepEqual(order.splice(0),[["read","entry"]]);
  entry=null;await assert.rejects(resolver(null,input,context as never,{} as never),/not found/);assert.deepEqual(order.splice(0),[["read","entry"]]);
  entry={id:"entry",Recipient:{username:"alice"},text:"old",isPublic:false};
  assert.deepEqual(await resolver(null,input,context as never,{} as never),name==="delete"?true:{...entry,isPublic:true});
  assert.deepEqual(order,[["read","entry"],["write","entry",...(name==="visibility"?[true]:[])]]);
 });
 test(`${name} write failure propagates unchanged`,async()=>{
  const failure=new Error("write failed");const resolver=factory({scratchpadRepository:{[read]:async()=>[{id:"entry",Recipient:{username:"alice"}}],[write]:async()=>{throw failure;}}} as never);
  await assert.rejects(resolver(null,{scratchpadEntryId:"entry",isPublic:true},context as never,{} as never),e=>e===failure);
 });
}
