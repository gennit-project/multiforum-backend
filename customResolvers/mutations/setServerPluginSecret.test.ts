import assert from "node:assert/strict";
import { test } from "node:test";
import type { Driver } from "neo4j-driver";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import type { ServerSecret } from "../../ogm_types.js";
import type { ServerSecretRepository } from "../../services/persistence/serverSecretRepository.js";
import { decryptSecret } from "../../services/plugin/encryption.js";
import createSetter from "./setServerPluginSecret.js";
function fixture(existing: boolean) {
  const calls: unknown[]=[];
  const repository:ServerSecretRepository={
    findForReplacement:async(pluginId,key)=>{calls.push(["find",pluginId,key]);return existing?[{id:"first"},{id:"second"}] as ServerSecret[]:[];},
    replaceCiphertext:async(id,ciphertext)=>{calls.push(["replace",id,decryptSecret(ciphertext)]);},
    createEncryptedSecret:async(pluginId,key,ciphertext,updatedAt)=>{assert.ok(Number.isFinite(Date.parse(updatedAt)));calls.push(["create",pluginId,key,decryptSecret(ciphertext)]);},
    findRenameCandidates:async()=>[],renameKey:async()=>{},
  };
  return {calls,repository,resolve:()=>createSetter({driver:{} as Driver,serverSecretRepository:repository})(null,{pluginId:"scanner",key:"API",value:"synthetic-value"},{} as GraphQLContext,{} as GraphQLResolveInfo)};
}
test("secret setter encrypts and replaces only the first matched record",async()=>{
  const f=fixture(true);assert.equal(await f.resolve(),true);assert.deepEqual(f.calls,[["find","scanner","API"],["replace","first","synthetic-value"]]);
});
test("secret setter creates only after empty lookup",async()=>{
  const f=fixture(false);assert.equal(await f.resolve(),true);assert.deepEqual(f.calls,[["find","scanner","API"],["create","scanner","API","synthetic-value"]]);
});
test("lookup and mutation failures preserve wrapper and stop subsequent work",async()=>{
  const f=fixture(false);f.repository.findForReplacement=async()=>{throw new Error("lookup failed");};await assert.rejects(f.resolve(),{message:"Failed to set server plugin secret: lookup failed"});assert.deepEqual(f.calls,[]);
  const g=fixture(true);g.repository.replaceCiphertext=async()=>{throw new Error("write failed");};await assert.rejects(g.resolve(),{message:"Failed to set server plugin secret: write failed"});assert.deepEqual(g.calls,[["find","scanner","API"]]);
});
