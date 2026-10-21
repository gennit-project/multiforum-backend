import type { Driver } from "neo4j-driver";
import type { PluginRunUpdateInput, PluginPipelineRunUpdateInput, UpdatePluginRunsMutationResponse, UpdatePluginPipelineRunsMutationResponse } from "../../ogm_types.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
export const PLUGIN_RUN_DEFAULT_SELECTION = `{
  id
  pluginId
  pluginName
  version
  scope
  channelId
  eventType
  status
  message
  durationMs
  targetId
  targetType
  pipelineId
  executionOrder
  skippedReason
  leaseId
  payload
  publicDiagnostics
  queuedAt
  startedAt
  heartbeatAt
  timeoutAt
  finishedAt
  createdAt
  updatedAt
}`;
export const PIPELINE_RUN_DEFAULT_SELECTION = `{
  id
  pipelineId
  targetId
  targetType
  targetVersion
  eventType
  scope
  channelId
  initiatedByUsername
  retryOfPipelineRunId
  attemptNumber
  applicability
  policyId
  campaignId
  configurationSnapshot
  status
  trigger
  policyEffectiveAt
  notifiedAt
  queuedAt
  startedAt
  heartbeatAt
  timeoutAt
  finishedAt
  createdAt
  updatedAt
}`;
type LeaseIdentity = {pluginRunId:string;leaseId:string};
export interface PipelineLeaseRepository {
 claimPendingJob(id:string,update:PluginRunUpdateInput):Promise<{pluginRuns:Array<{id:string}>}>;
 renewOwnedJob(lease:LeaseIdentity,update:PluginRunUpdateInput):Promise<{pluginRuns:Array<{id:string}>}>;
 extendPendingJobs(pipelineId:string,timeoutAt:string):Promise<UpdatePluginRunsMutationResponse>;
 extendAttempt(pipelineId:string,update:PluginPipelineRunUpdateInput):Promise<UpdatePluginPipelineRunsMutationResponse>;
 completeOwnedJob(lease:LeaseIdentity,update:PluginRunUpdateInput):Promise<UpdatePluginRunsMutationResponse>;
}
export function createPipelineLeaseRepository(driver:Driver):PipelineLeaseRepository {
 return {
  async claimPendingJob(id,update){const r=await executeGeneratedOperation<{updatePluginRuns:{pluginRuns:Array<{id:string}>}}>(driver,`mutation ClaimPendingPipelineJob($where:PluginRunWhere,$update:PluginRunUpdateInput){updatePluginRuns(where:$where,update:$update){pluginRuns{id}}}`,{where:{id,status:'PENDING'},update});return r.updatePluginRuns;},
  async renewOwnedJob(lease,update){const r=await executeGeneratedOperation<{updatePluginRuns:{pluginRuns:Array<{id:string}>}}>(driver,`mutation RenewOwnedPipelineJob($where:PluginRunWhere,$update:PluginRunUpdateInput){updatePluginRuns(where:$where,update:$update){pluginRuns{id}}}`,{where:{id:lease.pluginRunId,leaseId:lease.leaseId,status:'RUNNING'},update});return r.updatePluginRuns;},
  async extendPendingJobs(pipelineId,timeoutAt){const r=await executeGeneratedOperation<{updatePluginRuns:UpdatePluginRunsMutationResponse}>(driver,`mutation ExtendPendingPipelineJobs($where:PluginRunWhere,$update:PluginRunUpdateInput){updatePluginRuns(where:$where,update:$update){pluginRuns${PLUGIN_RUN_DEFAULT_SELECTION}}}`,{where:{pipelineId,status:'PENDING'},update:{timeoutAt}});return r.updatePluginRuns;},
  async extendAttempt(pipelineId,update){const r=await executeGeneratedOperation<{updatePluginPipelineRuns:UpdatePluginPipelineRunsMutationResponse}>(driver,`mutation ExtendPipelineAttempt($where:PluginPipelineRunWhere,$update:PluginPipelineRunUpdateInput){updatePluginPipelineRuns(where:$where,update:$update){pluginPipelineRuns${PIPELINE_RUN_DEFAULT_SELECTION}}}`,{where:{pipelineId},update});return r.updatePluginPipelineRuns;},
  async completeOwnedJob(lease,update){const r=await executeGeneratedOperation<{updatePluginRuns:UpdatePluginRunsMutationResponse}>(driver,`mutation CompleteOwnedPipelineJob($where:PluginRunWhere,$update:PluginRunUpdateInput){updatePluginRuns(where:$where,update:$update){pluginRuns${PLUGIN_RUN_DEFAULT_SELECTION}}}`,{where:{id:lease.pluginRunId,leaseId:lease.leaseId,status:'RUNNING'},update});return r.updatePluginRuns;},
 };
}
