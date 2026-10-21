import {PluginPipelineRunStatus} from "../../ogm_types.js";
import type { ModelMap } from '../../ogm_types.js';
import type { PipelineAttemptRepository } from '../../services/persistence/pipelineAttemptRepository.js';
// Retain existing execution-test model recorders behind the explicit domain port.
export function pipelineAttemptRepositoryStub(model:ModelMap['PluginPipelineRun']):PipelineAttemptRepository {
 return {
  findAttemptNumbers:where=>model.find({where,selectionSet:'{ attemptNumber }'}),
  createQueuedAttempt:input=>model.create({input:[input]}),
  markRunning:async(pipelineId,startedAt)=>{await model.update({where:{pipelineId},update:{status:PluginPipelineRunStatus.Running,startedAt}});},
  completeAttempt:async(pipelineId,update)=>{await model.update({where:{pipelineId},update});},
 };
}
