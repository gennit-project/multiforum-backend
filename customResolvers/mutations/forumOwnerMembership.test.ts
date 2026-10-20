import assert from "node:assert/strict";
import test from "node:test";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";
import type { ForumOwnerRepository } from "../../services/persistence/forumOwnerRepository.js";
import acceptInvite from "./acceptForumOwnerInvite.js";
import cancelInvite from "./cancelInviteForumOwner.js";
import removeOwner from "./removeForumOwner.js";
import becomeAdmin from "./becomeForumAdmin.js";
const info={} as GraphQLResolveInfo;
const build=(overrides:Partial<ForumOwnerRepository>={})=>{
 const calls:string[]=[];
 const repository:ForumOwnerRepository={
  findPendingInvites:async name=>{calls.push(`pending:${name}`);return [{PendingOwnerInvites:[{username:"alice"}]}];},
  findAdmins:async name=>{calls.push(`admins:${name}`);return [{Admins:[]}];},
  connectOwner:async(name,user)=>{calls.push(`connect:${name}:${user}`);return {channels:[{}]};},
  disconnectOwner:async(name,user)=>{calls.push(`remove:${name}:${user}`);return {channels:[{}]};},
  disconnectInvite:async(name,user)=>{calls.push(`cancel:${name}:${user}`);return {channels:[{}]};},...overrides,
 };
 const context={user:{username:"alice"},forumOwnerRepository:repository,ogm:{model:()=>{throw new Error("Unexpected OGM");}},channelPermissionRepository:{findAuthorizationSnapshot:async()=>{calls.push("zero-admins");return {Admins:[]};}}} as unknown as GraphQLContext;
 return {context,calls,repository};
};
test("owner acceptance reads pending invite and performs two ordered writes for the authenticated identity",async()=>{
 const {context,calls}=build();
 assert.equal(await acceptInvite()(null,{channelUniqueName:"cats"},context,info),true);
 assert.deepEqual(calls,["pending:cats","connect:cats:alice","cancel:cats:alice"]);
});
test("owner acceptance preserves first-write success when invite removal fails",async()=>{
 const {context,calls}=build({disconnectInvite:async()=>{calls.push("cancel-failed");throw new Error("second write failed");}});
 assert.equal(await acceptInvite()(null,{channelUniqueName:"cats"},context,info),false);
 assert.deepEqual(calls,["pending:cats","connect:cats:alice","cancel-failed"]);
});
test("owner acceptance stops after failed or unmatched first write",async()=>{
 for(const connectOwner of [async()=>{throw new Error("failed");},async()=>({channels:[]})]){
  const {context,calls}=build({connectOwner});assert.equal(await acceptInvite()(null,{channelUniqueName:"cats"},context,info),false);assert.deepEqual(calls,["pending:cats"]);
 }
});
test("pending-invite read errors and absent invites escape before writes",async()=>{
 for(const findPendingInvites of [async()=>{throw new Error("read failure");},async()=>[]]){
  const {context,calls}=build({findPendingInvites});await assert.rejects(acceptInvite()(null,{channelUniqueName:"cats"},context,info));assert.deepEqual(calls,[]);
 }
});
test("owner cancellation and removal preserve argument identity and false-on-write-error",async()=>{
 const {context,calls}=build();assert.equal(await cancelInvite()(null,{channelUniqueName:"cats",inviteeUsername:"bob"},context,info),true);assert.equal(await removeOwner()(null,{channelUniqueName:"cats",username:"bob"},context,info),true);assert.deepEqual(calls,["cancel:cats:bob","remove:cats:bob"]);
 for(const factory of [cancelInvite,removeOwner]){
  const {context}=build({disconnectInvite:async()=>{throw new Error("failed");},disconnectOwner:async()=>({channels:[]})});
  assert.equal(await factory()(null,{channelUniqueName:"cats",inviteeUsername:"bob",username:"bob"},context,info),false);
 }
});
test("become admin keeps zero-admin check, explicit read and write order",async()=>{
 const {context,calls}=build();assert.equal(await becomeAdmin()(null,{channelUniqueName:"cats"},context,info),true);assert.deepEqual(calls,["zero-admins","admins:cats","connect:cats:alice"]);
});
test("become admin read errors escape but write errors use its existing failure message",async()=>{
 const first=build({findAdmins:async()=>{throw new Error("read failure");}});await assert.rejects(becomeAdmin()(null,{channelUniqueName:"cats"},first.context,info),{message:"read failure"});
 const second=build({connectOwner:async()=>{throw new Error("write failure");}});await assert.rejects(becomeAdmin()(null,{channelUniqueName:"cats"},second.context,info),{message:"Failed to become forum admin"});
});
test("accept and become admin reject missing identity before repository access",async()=>{
 for(const factory of [acceptInvite,becomeAdmin]){
  const {context,calls}=build();delete context.user;await assert.rejects(factory()(null,{channelUniqueName:"cats"},context,info),{message:"User must be logged in"});assert.deepEqual(calls,[]);
 }
});
