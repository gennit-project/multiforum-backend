import type { Driver } from "neo4j-driver";
import type { PluginRunWhere, UpdatePluginRunsMutationResponse, UpdatePluginPipelineRunsMutationResponse } from "../../ogm_types.js";

// FAMILY-3 / v7 (campaign #284). Callers pass flat update maps; generated
// updateX mutations need each scalar wrapped as { set: value }. (claimPendingEventJob
// runs raw Cypher and reads the flat values directly, so it is not setified.)
const setify = (update: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(update).map(([key, value]) => [key, { set: value }]));
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
  targetVersion
  retryCount
  nextAttemptAt
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
export type PluginEventClaimLimits = {concurrency:number;rateLimitPerMinute:number;windowStart:string};
export interface PipelineLeaseRepository {
 cancelOlderPendingJobs(where:PluginRunWhere,update:Record<string,unknown>):Promise<UpdatePluginRunsMutationResponse>;
 claimPendingJob(id:string,update:Record<string,unknown>):Promise<{pluginRuns:Array<{id:string}>}>;
 claimPendingEventJob?(id:string,update:Record<string,unknown>,limits:PluginEventClaimLimits):Promise<{pluginRuns:Array<{id:string}>}>;
 renewOwnedJob(lease:LeaseIdentity,update:Record<string,unknown>):Promise<{pluginRuns:Array<{id:string}>}>;
 extendPendingJobs(pipelineId:string,timeoutAt:string):Promise<UpdatePluginRunsMutationResponse>;
 extendAttempt(pipelineId:string,update:Record<string,unknown>):Promise<UpdatePluginPipelineRunsMutationResponse>;
 rescheduleOwnedJob(lease:LeaseIdentity,update:Record<string,unknown>):Promise<UpdatePluginRunsMutationResponse>;
 completeOwnedJob(lease:LeaseIdentity,update:Record<string,unknown>):Promise<UpdatePluginRunsMutationResponse>;
}
export function createPipelineLeaseRepository(driver:Driver):PipelineLeaseRepository {
 return {
  async cancelOlderPendingJobs(where,update){const r=await executeGeneratedOperation<{updatePluginRuns:UpdatePluginRunsMutationResponse}>(driver,`mutation CancelOlderPendingPipelineJobs($where:PluginRunWhere,$update:PluginRunUpdateInput){updatePluginRuns(where:$where,update:$update){pluginRuns${PLUGIN_RUN_DEFAULT_SELECTION}}}`,{where,update:setify(update)});return r.updatePluginRuns;},
  async claimPendingJob(id,update){const r=await executeGeneratedOperation<{updatePluginRuns:{pluginRuns:Array<{id:string}>}}>(driver,`mutation ClaimPendingPipelineJob($where:PluginRunWhere,$update:PluginRunUpdateInput){updatePluginRuns(where:$where,update:$update){pluginRuns{id}}}`,{where:{id:{eq:id},status:{eq:'PENDING'}},update:setify(update)});return r.updatePluginRuns;},
  async claimPendingEventJob(id,update,limits){
   const session=driver.session();
   const transaction=await session.beginTransaction();
   try {
    const lock=await transaction.run(
     `MATCH (limiter:ServerConfig)
      WITH limiter ORDER BY limiter.serverName ASC LIMIT 1
      SET limiter.sequence=coalesce(limiter.sequence,0)+1
      RETURN limiter.sequence`
    );
    if(lock.records.length===0){await transaction.rollback();return {pluginRuns:[]};}
    const result=await transaction.run(
     `MATCH (limiter:ServerConfig)
     WITH limiter ORDER BY limiter.serverName ASC LIMIT 1
     MATCH (job:PluginRun {id:$id,status:'PENDING',deferred:true})
     WHERE job.nextAttemptAt IS NULL
       OR job.nextAttemptAt <= datetime($update.startedAt)
     CALL {
       MATCH (running:PluginRun {status:'RUNNING',deferred:true})
       WHERE running.targetType IN ['Comment','Discussion']
       RETURN count(running) AS runningCount
     }
     WITH limiter,job,runningCount,
          [started IN coalesce(limiter.pluginEventStartTimes, [])
           WHERE started >= datetime($windowStart)] AS recentStarts
     WHERE runningCount < $concurrency
       AND size(recentStarts) < $rateLimitPerMinute
     SET limiter.pluginEventStartTimes=recentStarts+datetime($update.startedAt),
         job.status=$update.status,
         job.leaseId=$update.leaseId,
         job.startedAt=datetime($update.startedAt),
         job.heartbeatAt=datetime($update.heartbeatAt),
         job.timeoutAt=datetime($update.timeoutAt),
         job.nextAttemptAt=null
     RETURN job.id AS id`,
     {id,update, ...limits}
    );
    await transaction.commit();
    return {pluginRuns:result.records.map(record=>({id:String(record.get('id'))}))};
   } catch(error) {
    await transaction.rollback();
    throw error;
   } finally {
    await session.close();
   }
  },
  async renewOwnedJob(lease,update){const r=await executeGeneratedOperation<{updatePluginRuns:{pluginRuns:Array<{id:string}>}}>(driver,`mutation RenewOwnedPipelineJob($where:PluginRunWhere,$update:PluginRunUpdateInput){updatePluginRuns(where:$where,update:$update){pluginRuns{id}}}`,{where:{id:{eq:lease.pluginRunId},leaseId:{eq:lease.leaseId},status:{eq:'RUNNING'}},update:setify(update)});return r.updatePluginRuns;},
  async extendPendingJobs(pipelineId,timeoutAt){const r=await executeGeneratedOperation<{updatePluginRuns:UpdatePluginRunsMutationResponse}>(driver,`mutation ExtendPendingPipelineJobs($where:PluginRunWhere,$update:PluginRunUpdateInput){updatePluginRuns(where:$where,update:$update){pluginRuns${PLUGIN_RUN_DEFAULT_SELECTION}}}`,{where:{pipelineId:{eq:pipelineId},status:{eq:'PENDING'}},update:setify({timeoutAt})});return r.updatePluginRuns;},
  async extendAttempt(pipelineId,update){const r=await executeGeneratedOperation<{updatePluginPipelineRuns:UpdatePluginPipelineRunsMutationResponse}>(driver,`mutation ExtendPipelineAttempt($where:PluginPipelineRunWhere,$update:PluginPipelineRunUpdateInput){updatePluginPipelineRuns(where:$where,update:$update){pluginPipelineRuns${PIPELINE_RUN_DEFAULT_SELECTION}}}`,{where:{pipelineId:{eq:pipelineId}},update:setify(update)});return r.updatePluginPipelineRuns;},
  async rescheduleOwnedJob(lease,update){const r=await executeGeneratedOperation<{updatePluginRuns:UpdatePluginRunsMutationResponse}>(driver,`mutation RescheduleOwnedPipelineJob($where:PluginRunWhere,$update:PluginRunUpdateInput){updatePluginRuns(where:$where,update:$update){pluginRuns${PLUGIN_RUN_DEFAULT_SELECTION}}}`,{where:{id:{eq:lease.pluginRunId},leaseId:{eq:lease.leaseId},status:{eq:'RUNNING'}},update:setify(update)});return r.updatePluginRuns;},
  async completeOwnedJob(lease,update){const r=await executeGeneratedOperation<{updatePluginRuns:UpdatePluginRunsMutationResponse}>(driver,`mutation CompleteOwnedPipelineJob($where:PluginRunWhere,$update:PluginRunUpdateInput){updatePluginRuns(where:$where,update:$update){pluginRuns${PLUGIN_RUN_DEFAULT_SELECTION}}}`,{where:{id:{eq:lease.pluginRunId},leaseId:{eq:lease.leaseId},status:{eq:'RUNNING'}},update:setify(update)});return r.updatePluginRuns;},
 };
}
