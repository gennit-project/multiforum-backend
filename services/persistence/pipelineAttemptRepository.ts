import type { Driver } from "neo4j-driver";
import type { PluginPipelineRunWhere, PluginPipelineRunCreateInput, PluginPipelineRunUpdateInput, CreatePluginPipelineRunsMutationResponse } from "../../ogm_types.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import { PIPELINE_RUN_DEFAULT_SELECTION } from "./pipelineLeaseRepository.js";
export interface PipelineAttemptRepository {
 findAttemptNumbers(where:Pick<PluginPipelineRunWhere,'targetId'|'targetType'|'eventType'|'scope'>):Promise<Array<{attemptNumber:number}>>;
 createQueuedAttempt(input:PluginPipelineRunCreateInput):Promise<CreatePluginPipelineRunsMutationResponse>;
 markRunning(pipelineId:string,startedAt:string):Promise<void>;
 completeAttempt(pipelineId:string,update:PluginPipelineRunUpdateInput):Promise<void>;
}
export function createPipelineAttemptRepository(driver:Driver):PipelineAttemptRepository {
 return {
  async findAttemptNumbers(where){const r=await executeGeneratedOperation<{pluginPipelineRuns:Array<{attemptNumber:number}>}>(driver,`query PreviousPipelineAttemptNumbers($where:PluginPipelineRunWhere){pluginPipelineRuns(where:$where){attemptNumber}}`,{where});return r.pluginPipelineRuns;},
  async createQueuedAttempt(input){const r=await executeGeneratedOperation<{createPluginPipelineRuns:CreatePluginPipelineRunsMutationResponse}>(driver,`mutation CreateQueuedPipelineAttempt($input:[PluginPipelineRunCreateInput!]!){createPluginPipelineRuns(input:$input){pluginPipelineRuns${PIPELINE_RUN_DEFAULT_SELECTION}}}`,{input:[input]});return r.createPluginPipelineRuns;},
  async markRunning(pipelineId,startedAt){await executeGeneratedOperation(driver,`mutation MarkPipelineAttemptRunning($where:PluginPipelineRunWhere,$update:PluginPipelineRunUpdateInput){updatePluginPipelineRuns(where:$where,update:$update){pluginPipelineRuns${PIPELINE_RUN_DEFAULT_SELECTION}}}`,{where:{pipelineId:{eq:pipelineId}},update:{status:{set:'RUNNING'},startedAt:{set:startedAt}}});},
  async completeAttempt(pipelineId,update){await executeGeneratedOperation(driver,`mutation CompletePipelineAttempt($where:PluginPipelineRunWhere,$update:PluginPipelineRunUpdateInput){updatePluginPipelineRuns(where:$where,update:$update){pluginPipelineRuns${PIPELINE_RUN_DEFAULT_SELECTION}}}`,{where:{pipelineId:{eq:pipelineId}},update});},
 };
}
