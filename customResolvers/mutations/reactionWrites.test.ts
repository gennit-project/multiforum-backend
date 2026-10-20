import assert from "node:assert/strict";
import test from "node:test";
import addComment from "./addEmojiToComment.js";
import removeComment from "./removeEmojiFromComment.js";
import addDiscussion from "./addEmojiToDiscussionChannel.js";
import removeDiscussion from "./removeEmojiFromDiscussionChannel.js";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";
const info={} as GraphQLResolveInfo;
for(const [name,factory,idKey,method,stateMethod,adding] of [
 ["add comment",addComment,"commentId","updateCommentEmoji","findCommentEmojiState",true],
 ["remove comment",removeComment,"commentId","updateCommentEmoji","findCommentEmojiState",false],
 ["add discussion",addDiscussion,"discussionChannelId","updateDiscussionChannelEmoji","findDiscussionChannelEmojiState",true],
 ["remove discussion",removeDiscussion,"discussionChannelId","updateDiscussionChannelEmoji","findDiscussionChannelEmojiState",false],
] as const){
 test(`${name} preserves caller username, repeats, write ordering and public projection`,async()=>{
  const order:string[]=[];const writes:unknown[]=[];let emoji="";
  const state={id:"target",archived:false,locked:false,Channel:{uniqueName:"cats",emojiEnabled:true}};
  const context={user:{username:"different-actor"},contentValidationRepository:{[stateMethod]:async()=>{order.push("read");return [{...state,emoji}];}}} as unknown as GraphQLContext;
  const resolver=factory({reactionWriter:{[method]:async(id:string,value:string)=>{order.push("write");writes.push({id,value});emoji=value;}}} as never);
  const args={[idKey]:"target",username:"supplied-actor",emojiLabel:"thumbsup",unicode:"👍"};
  for(let i=0;i<2;i++){
   const expected=adding?'{"thumbsup":{"👍":["supplied-actor"]}}':'{}';
   assert.deepEqual(await resolver(null,args as never,context,info),{id:"target",emoji:expected});
  }
  assert.deepEqual(writes,[{id:"target",value:emoji},{id:"target",value:emoji}]);assert.deepEqual(order,["read","write","read","write"]);
 });
 test(`${name} malformed stored JSON never reaches persistence`,async()=>{
  let writes=0;const resolver=factory({reactionWriter:{[method]:async()=>{writes++;}}} as never);
  const context={contentValidationRepository:{[stateMethod]:async()=>[{id:"target",emoji:"bad JSON",Channel:{uniqueName:"cats",emojiEnabled:true}}]}} as unknown as GraphQLContext;
  await assert.rejects(resolver(null,{[idKey]:"target",username:"actor",emojiLabel:"thumbsup",unicode:"👍"} as never,context,info),SyntaxError);assert.equal(writes,0);
 });
 if(!adding)test(`${name} removes actor from every unicode and prunes empty labels`,async()=>{
  let written="";const resolver=factory({reactionWriter:{[method]:async(_id:string,value:string)=>{written=value;}}} as never);
  const context={contentValidationRepository:{[stateMethod]:async()=>[{id:"target",emoji:'{"thumbsup":{"👍":["actor"],"👍🏻":["actor","other"]},"wave":{"👋":["actor"]}}',Channel:{uniqueName:"cats",emojiEnabled:true}}]}} as unknown as GraphQLContext;
  const result=await resolver(null,{[idKey]:"target",username:"actor",emojiLabel:"thumbsup"} as never,context,info);
  assert.equal(written,'{"thumbsup":{"👍🏻":["other"]},"wave":{"👋":["actor"]}}');assert.deepEqual(result,{id:"target",emoji:written});
 });
 test(`${name} required arguments and persistence failures retain errors`,async()=>{
  let writes=0;const failure=new Error("projection failed");
  const resolver=factory({reactionWriter:{[method]:async()=>{writes++;throw failure;}}} as never);
  await assert.rejects(resolver(null,{} as never,{} as GraphQLContext,info),/All arguments/);assert.equal(writes,0);
  const context={contentValidationRepository:{[stateMethod]:async()=>[{id:"target",emoji:"",Channel:{uniqueName:"cats",emojiEnabled:true}}]}} as unknown as GraphQLContext;
  await assert.rejects(resolver(null,{[idKey]:"target",username:"actor",emojiLabel:"thumbsup",unicode:"👍"} as never,context,info),error=>error===failure);assert.equal(writes,1);
 });
}
