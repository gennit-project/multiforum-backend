import type { ModelMap } from '../../ogm_types.js';
import type { PipelineLeaseRepository } from '../../services/persistence/pipelineLeaseRepository.js';
// Preserve existing execution-test model recorders while injecting the new domain port.
export function pipelineLeaseRepositoryStub(models: Partial<Pick<ModelMap,'PluginRun'|'PluginPipelineRun'>>):PipelineLeaseRepository {
 return {
  cancelOlderPendingJobs:(where,update)=>models.PluginRun!.update({where,update}),
  claimPendingJob:(id,update)=>models.PluginRun!.update({where:{id,status:'PENDING'},update,selectionSet:'{ pluginRuns { id } }'}),
  renewOwnedJob:(lease,update)=>models.PluginRun!.update({where:{id:lease.pluginRunId,leaseId:lease.leaseId,status:'RUNNING'},update,selectionSet:'{ pluginRuns { id } }'}),
  extendPendingJobs:(pipelineId,timeoutAt)=>models.PluginRun!.update({where:{pipelineId,status:'PENDING'},update:{timeoutAt}}),
  extendAttempt:(pipelineId,update)=>models.PluginPipelineRun!.update({where:{pipelineId},update}),
  completeOwnedJob:(lease,update)=>models.PluginRun!.update({where:{id:lease.pluginRunId,leaseId:lease.leaseId,status:'RUNNING'},update}),
 };
}
