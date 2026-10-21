import assert from "node:assert/strict";
import test from "node:test";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";
import type { ServerAdminRepository } from "../../services/persistence/serverAdminRepository.js";
import acceptInvite from "./acceptServerAdminInvite.js";
import cancelInvite from "./cancelInviteServerAdmin.js";
const info={} as GraphQLResolveInfo;
const build=(overrides:Partial<ServerAdminRepository>={})=>{
 const calls:string[]=[];
 const repository:ServerAdminRepository={
  findPendingInvites:async name=>{calls.push(`pending:${name}`);return [{PendingAdminInvites:[{username:"alice"}]}];},
  connectAdmin:async(name,user)=>{calls.push(`connect:${name}:${user}`);return {serverConfigs:[{}]};},
  disconnectInvite:async(name,user)=>{calls.push(`cancel:${name}:${user}`);return {serverConfigs:[{}]};},...overrides,
 };
 const context={user:{username:"alice"},serverAdminRepository:repository,ogm:{model:()=>{throw new Error("Unexpected OGM");}},} as unknown as GraphQLContext;
 return {context,calls,repository};
};
test("administrator acceptance reads pending invite and performs two ordered writes for the authenticated identity",async()=>{
 const {context,calls}=build();
 assert.equal(await acceptInvite()(null,{serverName:"cats"},context,info),true);
 assert.deepEqual(calls,["pending:cats","connect:cats:alice","cancel:cats:alice"]);
});
test("administrator acceptance preserves first-write success when invite removal fails",async()=>{
 const {context,calls}=build({disconnectInvite:async()=>{calls.push("cancel-failed");throw new Error("second write failed");}});
 assert.equal(await acceptInvite()(null,{serverName:"cats"},context,info),false);
 assert.deepEqual(calls,["pending:cats","connect:cats:alice","cancel-failed"]);
});
test("administrator acceptance stops after failed or unmatched first write",async()=>{
 for(const connectAdmin of [async()=>{throw new Error("failed");},async()=>({serverConfigs:[]})]){
  const {context,calls}=build({connectAdmin});assert.equal(await acceptInvite()(null,{serverName:"cats"},context,info),false);assert.deepEqual(calls,["pending:cats"]);
 }
});
test("pending-invite read errors and absent invites escape before writes",async()=>{
 for(const findPendingInvites of [async()=>{throw new Error("read failure");},async()=>[]]){
  const {context,calls}=build({findPendingInvites});await assert.rejects(acceptInvite()(null,{serverName:"cats"},context,info));assert.deepEqual(calls,[]);
 }
});
test("administrator cancellation preserves invitee identity and false-on-write-error",async()=>{
 const {context,calls}=build();assert.equal(await cancelInvite()(null,{serverName:"cats",inviteeUsername:"bob"},context,info),true);assert.deepEqual(calls,["cancel:cats:bob"]);
 const failed=build({disconnectInvite:async()=>{throw new Error("failed");}});assert.equal(await cancelInvite()(null,{serverName:"cats",inviteeUsername:"bob"},failed.context,info),false);
});
test("accept rejects missing identity before repository access",async()=>{
 for(const factory of [acceptInvite]){
  const {context,calls}=build();delete context.user;await assert.rejects(factory()(null,{serverName:"cats"},context,info),{message:"User must be logged in"});assert.deepEqual(calls,[]);
 }
});
