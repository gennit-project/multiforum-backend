import type {StartPluginPipelineInput} from "../../customResolvers/mutations/startPluginPipeline.js";
import type {PipelineStartRepository} from "../../services/persistence/pipelineStartRepository.js";
import {START_SELECTION_0,START_SELECTION_1,START_SELECTION_2,START_SELECTION_3,START_SELECTION_4,START_SELECTION_5} from "../../services/persistence/pipelineStartRepository.js";
// Legacy calls live only in characterization adapters.
export function pipelineStartRepositoryStub(models:StartPluginPipelineInput):PipelineStartRepository {return {
 findFileTarget:(id)=>models.DownloadableFile.find({where:{id},selectionSet:START_SELECTION_0}),
 findDiscussionTarget:(id)=>models.Discussion.find({where:{id},selectionSet:START_SELECTION_1}),
 findChannelPlan:(uniqueName)=>models.Channel.find({where:{uniqueName},selectionSet:START_SELECTION_2}),
 findServerPlan:()=>models.ServerConfig.find({selectionSet:START_SELECTION_3}),
 findActiveAttempts:(where)=>models.PluginPipelineRun.find({where,selectionSet:START_SELECTION_4}),
 findStartedAttempt:(pipelineId)=>models.PluginPipelineRun.find({where:{pipelineId},selectionSet:START_SELECTION_5}),
};}
