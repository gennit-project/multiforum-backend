import assert from "node:assert/strict";
import test from "node:test";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";
import type { ServerModeratorRepository } from "../../services/persistence/serverModeratorRepository.js";
import acceptInvite from "./acceptServerModInvite.js";
import cancelInvite from "./cancelInviteServerMod.js";
const info={} as GraphQLResolveInfo;
const build=(overrides:Partial<ServerModeratorRepository>={})=>{
 const calls:string[]=[];
 const repo:ServerModeratorRepository={
  findModeratorProfile:async username=>{calls.push(`profile:${username}`);return [{ModerationProfile:{displayName:"ModAlice"}}];},
  findPendingInvites:async name=>{calls.push(`pending:${name}`);return [{PendingModInvites:[{username:"alice"}]}];},
  connectModerator:async(name,profile)=>{calls.push(`connect:${name}:${profile}`);return {serverConfigs:[{}]};},
  disconnectInvite:async(name,user)=>{calls.push(`cancel:${name}:${user}`);return {serverConfigs:[{}]};},...overrides,
 };
 const context={user:{username:"alice"},serverModeratorRepository:repo,ogm:{model:()=>{throw new Error("Unexpected OGM acquisition");}}} as unknown as GraphQLContext;
 return {context,calls,repo};
};
test("moderator acceptance resolves private profile and pending invite before two ordered writes",async()=>{
 const {context,calls}=build();assert.equal(await acceptInvite()(null,{serverName:"cats"},context,info),true);assert.deepEqual(calls,["profile:alice","pending:cats","connect:cats:ModAlice","cancel:cats:alice"]);
});
test("moderator acceptance keeps first write when invite cancellation fails",async()=>{
 const {context,calls}=build({disconnectInvite:async()=>{calls.push("cancel-failed");throw new Error("failed");}});
 assert.equal(await acceptInvite()(null,{serverName:"cats"},context,info),false);assert.deepEqual(calls,["profile:alice","pending:cats","connect:cats:ModAlice","cancel-failed"]);
});
test("moderator acceptance stops after first write failure",async()=>{
 const {context,calls}=build({connectModerator:async()=>({serverConfigs:[]})});assert.equal(await acceptInvite()(null,{serverName:"cats"},context,info),false);assert.deepEqual(calls,["profile:alice","pending:cats"]);
});
test("profile and pending-invite lookup errors propagate before writes",async()=>{
 const first=build({findModeratorProfile:async()=>{throw new Error("profile failed");}});await assert.rejects(acceptInvite()(null,{serverName:"cats"},first.context,info),{message:"profile failed"});assert.deepEqual(first.calls,[]);
 const second=build({findPendingInvites:async()=>{throw new Error("pending failed");}});await assert.rejects(acceptInvite()(null,{serverName:"cats"},second.context,info),{message:"pending failed"});assert.deepEqual(second.calls,["profile:alice"]);
});
test("missing profiles and invitations preserve their explicit errors",async()=>{
 const first=build({findModeratorProfile:async()=>[]});await assert.rejects(acceptInvite()(null,{serverName:"cats"},first.context,info),{message:"User alice is not a moderator"});
 const second=build({findPendingInvites:async()=>[]});await assert.rejects(acceptInvite()(null,{serverName:"cats"},second.context,info),{message:"No pending moderator invite found for user alice"});
});
test("moderator cancellation uses invitee identity and returns false after write failure",async()=>{
 const {context,calls}=build();assert.equal(await cancelInvite()(null,{serverName:"cats",inviteeUsername:"bob"},context,info),true);assert.deepEqual(calls,["cancel:cats:bob"]);
 const fail=build({disconnectInvite:async()=>{throw new Error("failed");}});assert.equal(await cancelInvite()(null,{serverName:"cats",inviteeUsername:"bob"},fail.context,info),false);
});
