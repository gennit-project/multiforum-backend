import assert from "node:assert/strict";
import { test } from "node:test";
import type { Driver } from "neo4j-driver";
import type { PluginPipelineRun } from "../../ogm_types.js";
import createPublic from "./getPublicPluginPipelineRun.js";
import createInternal from "./getInternalPluginPipelineRun.js";
import type { PipelineDetailRepository } from "../../services/persistence/pipelineDetailRepository.js";
import type { PipelineTargetRepository } from "../../services/persistence/pipelineTargetRepository.js";
function fixture() {
  const calls:string[]=[];
  const attempt={id:"attempt",pipelineId:"pipeline",targetId:"file",targetType:"DownloadableFile"} as PluginPipelineRun;
  const detail:PipelineDetailRepository={
    findPublicAttempt:async(id)=>{calls.push(`attempt:${id}`);return [attempt];},
    findPublicJobs:async(id)=>{calls.push(`jobs:${id}`);return [];},
    findInternalAttempt:async(id)=>{calls.push(`internalAttempt:${id}`);return [attempt];},
    findInternalJobs:async(id)=>{calls.push(`internalJobs:${id}`);return [];},
  };
  const target:PipelineTargetRepository={
    findDownloadVisibility:async()=>{calls.push("visibility");return [{id:"file",Discussion:{DiscussionChannels:[{archived:false}]}}];},
    findDiscussionVisibility:async()=>[],findDownloadTiming:async()=>[],listServerApplicabilityConfigs:async()=>[],findChannelApplicabilityConfig:async()=>[],
  };
  return {calls,detail,target,
    publicRead:()=>createPublic({driver:{} as Driver,pipelineDetailRepository:detail,pipelineTargetRepository:target})(null,{pipelineRunId:"attempt"}),
    internalRead:()=>createInternal({driver:{} as Driver,pipelineDetailRepository:detail})(null,{pipelineRunId:"attempt"}),
  };
}
test("public detail preserves attempt then visibility then jobs order",async()=>{
  const f=fixture();await f.publicRead();assert.deepEqual(f.calls,["attempt:attempt","visibility","jobs:pipeline"]);
});
test("missing public attempt returns null without visibility or jobs",async()=>{
  const f=fixture();f.detail.findPublicAttempt=async()=>[];assert.equal(await f.publicRead(),null);assert.deepEqual(f.calls,[]);
});
test("hidden public target never reads jobs",async()=>{
  const f=fixture();f.target.findDownloadVisibility=async()=>[];await assert.rejects(f.publicRead(),/Pipeline target not found/);assert.deepEqual(f.calls,["attempt:attempt"]);
});
test("internal detail reads attempt then jobs without public visibility",async()=>{
  const f=fixture();await f.internalRead();assert.deepEqual(f.calls,["internalAttempt:attempt","internalJobs:pipeline"]);
});
test("missing internal attempt returns null and job errors propagate",async()=>{
  const f=fixture();f.detail.findInternalAttempt=async()=>[];assert.equal(await f.internalRead(),null);assert.deepEqual(f.calls,[]);
  const g=fixture();const error=new Error("jobs unavailable");g.detail.findInternalJobs=async()=>{throw error;};await assert.rejects(g.internalRead(),(actual:unknown)=>actual===error);
});
