import assert from "node:assert/strict";
import { test } from "node:test";
import type { Driver } from "neo4j-driver";
import createSummary from "./getPluginPipelineSummary.js";
import type { PipelineHistoryRepository } from "../../services/persistence/pipelineHistoryRepository.js";
import type { PipelineTargetRepository } from "../../services/persistence/pipelineTargetRepository.js";

function fixture() {
  const calls: string[] = [];
  const target: PipelineTargetRepository = {
    findDiscussionVisibility: async () => [],
    findDownloadVisibility: async () => { calls.push("visibility"); return [{id:"file",Discussion:{id:"discussion",DiscussionChannels:[{archived:false}]}}]; },
    findDownloadTiming: async () => [], listServerApplicabilityConfigs: async () => [], findChannelApplicabilityConfig: async () => [],
  };
  const history: PipelineHistoryRepository = {
    findPipelineHistory: async () => [], findDownloadHistory: async () => [],
    findSummaryAttempts: async (id,type) => { calls.push(`attempts:${id}:${type}`); return []; },
    findSummaryJobs: async (id,type) => { calls.push(`jobs:${id}:${type}`); return []; },
  };
  return { calls,target,history, resolve: () => createSummary({driver:{} as Driver,pipelineTargetRepository:target,pipelineHistoryRepository:history})(null,{targetId:"file",targetType:"DownloadableFile"}) };
}
test("summary reads visibility, attempts, then jobs even when attempts are empty", async () => {
  const f=fixture();
  assert.deepEqual(await f.resolve(),{targetId:"file",targetType:"DownloadableFile",attempts:[]});
  assert.deepEqual(f.calls,["visibility","attempts:file:DownloadableFile","jobs:file:DownloadableFile"]);
});
test("hidden targets never read history", async () => {
  const f=fixture();f.target.findDownloadVisibility=async()=>[];
  await assert.rejects(f.resolve(),/Pipeline target not found/);
  assert.deepEqual(f.calls,[]);
});
test("attempt lookup failure propagates and prevents job lookup", async () => {
  const f=fixture();const error=new Error("attempts failed");
  f.history.findSummaryAttempts=async()=>{throw error;};
  await assert.rejects(f.resolve(),(actual:unknown)=>actual===error);
  assert.deepEqual(f.calls,["visibility"]);
});
test("job lookup failure propagates even with no attempts", async () => {
  const f=fixture();const error=new Error("jobs failed");
  f.history.findSummaryJobs=async()=>{throw error;};
  await assert.rejects(f.resolve(),(actual:unknown)=>actual===error);
  assert.deepEqual(f.calls,["visibility","attempts:file:DownloadableFile"]);
});
