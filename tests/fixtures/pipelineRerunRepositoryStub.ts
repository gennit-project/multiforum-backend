import type {ModelMap} from "../../ogm_types.js";
import type {PipelineRerunRepository} from "../../services/persistence/pipelineRerunRepository.js";
import {RERUN_SELECTION_0,RERUN_SELECTION_1,RERUN_SELECTION_2,RERUN_SELECTION_3} from "../../services/persistence/pipelineRerunRepository.js";
export function pipelineRerunRepositoryStub(models:Pick<ModelMap,'PluginPipelineRun'|'DownloadableFile'|'Discussion'>):PipelineRerunRepository {return {
 findSourceAttempt:(pipelineId)=>models.PluginPipelineRun.find({where:{pipelineId},selectionSet:RERUN_SELECTION_0}),
 findFileVersion:(id)=>models.DownloadableFile.find({where:{id},selectionSet:RERUN_SELECTION_1}),
 findDiscussionVersion:(id)=>models.Discussion.find({where:{id},selectionSet:RERUN_SELECTION_2}),
 findRelatedAttempts:(where)=>models.PluginPipelineRun.find({where,selectionSet:RERUN_SELECTION_3}),
};}
