import type {ModelMap} from '../../ogm_types.js';
import type {PipelineWatchdogRepository} from '../../services/persistence/pipelineWatchdogRepository.js';
export function pipelineWatchdogRepositoryStub(models:Pick<ModelMap,'PluginRun'|'PluginPipelineRun'>):PipelineWatchdogRepository {
 return {
  findActiveJobs:()=>models.PluginRun.find({where:{status_IN:['PENDING','RUNNING']},selectionSet:'{id pipelineId status queuedAt startedAt heartbeatAt timeoutAt createdAt}'}),
  markExpiredJob:(id,hasExplicitDeadline,timestamp)=>models.PluginRun.update({where:{id,status_IN:['PENDING','RUNNING'],...(hasExplicitDeadline?{timeoutAt_LTE:timestamp}:{timeoutAt:null})},update:{status:'TIMED_OUT',message:'Plugin execution lease expired',heartbeatAt:timestamp,finishedAt:timestamp,timeoutAt:null},selectionSet:'{pluginRuns{id}}'}),
  findActiveAttempt:pipelineId=>models.PluginPipelineRun.find({where:{pipelineId,status_IN:['QUEUED','RUNNING'] as any},selectionSet:'{pipelineId status}'}),
  findAttemptJobStatuses:pipelineId=>models.PluginRun.find({where:{pipelineId},selectionSet:'{status}'}),
 };
}
