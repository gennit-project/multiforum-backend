import assert from "node:assert/strict";
import {test} from "node:test";
import type {Driver} from "neo4j-driver";
import create from "./updatePluginPipelines.js";
import type {ServerPipelineRepository} from "../../services/persistence/serverPipelineRepository.js";
function fixture(){const calls:unknown[]=[];const repo:ServerPipelineRepository={listCurrent:async()=>{calls.push("read");return [{serverName:"first"},{serverName:"second"}];},save:async(name,value)=>{calls.push([name,JSON.parse(value)]);}};return {calls,repo,resolve:(pipelines:Parameters<ReturnType<typeof create>>[1]['pipelines'])=>create({driver:{} as Driver,serverPipelineRepository:repo})(null,{pipelines},{},{})};}
test("validation precedes reads and missing configuration prevents writes",async()=>{const f=fixture();await assert.rejects(f.resolve([{event:"",steps:[]}]),/each pipeline must have an event/);assert.deepEqual(f.calls,[]);f.repo.listCurrent=async()=>[];await assert.rejects(f.resolve([]),/No server config found/);assert.deepEqual(f.calls,[]);});
test("first configuration is written once after reading; explicit policy values retained",async()=>{const f=fixture();const pipelines=[{event:"downloadableFile.created",steps:[{pluginId:"scanner"}],policyId:"policy",effectiveAt:"2026-01-01T00:00:00Z",applicability:"ALL_FILES_IMMEDIATE" as const}];assert.deepEqual(await f.resolve(pipelines),pipelines);assert.deepEqual(f.calls,["read",["first",pipelines]]);});
test("write errors propagate without retry",async()=>{const f=fixture();let count=0;f.repo.save=async()=>{count++;throw new Error("write failed");};await assert.rejects(f.resolve([]),/write failed/);assert.equal(count,1);});
