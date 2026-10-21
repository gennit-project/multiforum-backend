import assert from "node:assert/strict";
import {test} from "node:test";
import type {Driver} from "neo4j-driver";
import type {Channel,ChannelModel,UserModel} from "../../ogm_types.js";
import type {ChannelPipelineRepository} from "../../services/persistence/channelPipelineRepository.js";
import create from "./updateChannelPluginPipelines.js";
function fixture(){
  const calls:string[]=[];const repo:ChannelPipelineRepository={
    findSettings:async()=>{calls.push("read");return [{uniqueName:"cats",Bots:[{username:"bot-a"},{username:"bot-b"},{username:"human"}]}] as Channel[];},
    savePipelines:async()=>{calls.push("save");},listServerSettings:async()=>{calls.push("server");return [];},
    deprecateBot:async(username)=>{calls.push(`deprecate:${username}`);},disconnectBots:async(_name,usernames)=>{calls.push(`disconnect:${usernames.join(',')}`);},
  };
  const resolve=(pipelines=[{event:"comment.created",steps:[{pluginId:"scanner"}]}])=>create({driver:{} as Driver,channelPipelineRepository:repo})(null,{channelUniqueName:"cats",pipelines},{},{});
  return {calls,repo,resolve};
}
test("channel pipeline validates before reads and does not read server before saving",async()=>{const f=fixture();await assert.rejects(f.resolve([{event:"downloadableFile.created",steps:[{pluginId:"scanner"}]}]),/Invalid event/);assert.deepEqual(f.calls,[]);await f.resolve();assert.deepEqual(f.calls,["read","save","server","deprecate:bot-a","deprecate:bot-b","disconnect:bot-a,bot-b"]);});
test("missing channel and initial write failures propagate before bot work",async()=>{const f=fixture();f.repo.findSettings=async()=>[];await assert.rejects(f.resolve(),/Channel "cats" not found/);assert.deepEqual(f.calls,[]);const g=fixture();g.repo.savePipelines=async()=>{throw new Error("save failed");};await assert.rejects(g.resolve(),/save failed/);assert.deepEqual(g.calls,["read"]);});
test("server read failure after save is swallowed and returned pipelines are unchanged",async()=>{const f=fixture();f.repo.listServerSettings=async()=>{throw new Error("server failed");};const input=[{event:"comment.created",steps:[{pluginId:"scanner"}]}];assert.equal(await f.resolve(input),input);assert.deepEqual(f.calls,["read","save"]);});
test("second bot failure keeps earlier deprecation and prevents disconnect without rejecting",async()=>{const f=fixture();f.repo.deprecateBot=async(name)=>{f.calls.push(`deprecate:${name}`);if(name==="bot-b")throw new Error("bot failure");};await f.resolve();assert.deepEqual(f.calls,["read","save","server","deprecate:bot-a","deprecate:bot-b"]);});
test("disconnect failure is swallowed after all deprecations",async()=>{const f=fixture();f.repo.disconnectBots=async()=>{f.calls.push("disconnect");throw new Error("disconnect failed");};await f.resolve();assert.deepEqual(f.calls,["read","save","server","deprecate:bot-a","deprecate:bot-b","disconnect"]);});
