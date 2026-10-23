import type { Driver } from "neo4j-driver";
import type { PluginRun, PluginPipelineRun } from "../../ogm_types.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
export const EXPIRABLE_PIPELINE_JOB_SELECTION = `{id pipelineId status deferred queuedAt startedAt heartbeatAt timeoutAt createdAt}`;
type ExpirablePipelineJob = Omit<Pick<PluginRun,'id'|'pipelineId'|'status'|'deferred'|'queuedAt'|'startedAt'|'heartbeatAt'|'timeoutAt'|'createdAt'>,'deferred'> & {deferred?:boolean|null};
export interface PipelineWatchdogRepository {
 findActiveJobs():Promise<ExpirablePipelineJob[]>;
 markExpiredJob(id:string,hasExplicitDeadline:boolean,timestamp:string):Promise<{pluginRuns:Array<{id:string}>}>;
 findActiveAttempt(pipelineId:string):Promise<Array<Pick<PluginPipelineRun,'pipelineId'|'status'>>>;
 findAttemptJobStatuses(pipelineId:string):Promise<Array<{status:string}>>;
}
export function createPipelineWatchdogRepository(driver:Driver):PipelineWatchdogRepository {
 return {
  async findActiveJobs(){const r=await executeGeneratedOperation<{pluginRuns:PluginRun[]}>(driver,`query ActivePipelineJobsForRecovery($where:PluginRunWhere){pluginRuns(where:$where)${EXPIRABLE_PIPELINE_JOB_SELECTION}}`,{where:{status_IN:['PENDING','RUNNING']}});return r.pluginRuns.map(({deferred,...job})=>deferred===true?{...job,deferred}:job);},
  async markExpiredJob(id,hasExplicitDeadline,timestamp){const r=await executeGeneratedOperation<{updatePluginRuns:{pluginRuns:Array<{id:string}>}}>(driver,`mutation MarkExpiredPipelineJob($where:PluginRunWhere,$update:PluginRunUpdateInput){updatePluginRuns(where:$where,update:$update){pluginRuns{id}}}`,{where:{id,status_IN:['PENDING','RUNNING'],...(hasExplicitDeadline?{timeoutAt_LTE:timestamp}:{timeoutAt:null})},update:{status:'TIMED_OUT',message:'Plugin execution lease expired',heartbeatAt:timestamp,finishedAt:timestamp,timeoutAt:null}});return r.updatePluginRuns;},
  async findActiveAttempt(pipelineId){const r=await executeGeneratedOperation<{pluginPipelineRuns:PluginPipelineRun[]}>(driver,`query ActivePipelineAttemptForRecovery($where:PluginPipelineRunWhere){pluginPipelineRuns(where:$where){pipelineId status}}`,{where:{pipelineId,status_IN:['QUEUED','RUNNING']}});return r.pluginPipelineRuns;},
  async findAttemptJobStatuses(pipelineId){const r=await executeGeneratedOperation<{pluginRuns:Array<{status:string}>}>(driver,`query PipelineJobStatusesForRecovery($where:PluginRunWhere){pluginRuns(where:$where){status}}`,{where:{pipelineId}});return r.pluginRuns;},
 };
}
