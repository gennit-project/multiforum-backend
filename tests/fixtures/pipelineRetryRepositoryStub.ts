import type {RetryDownloadableFileScanInput} from "../../customResolvers/mutations/retryDownloadableFileScan.js";
import type {PipelineRetryRepository} from "../../services/persistence/pipelineRetryRepository.js";
import {RETRY_SELECTION_0,RETRY_SELECTION_1,RETRY_SELECTION_2} from "../../services/persistence/pipelineRetryRepository.js";
export function pipelineRetryRepositoryStub(models:RetryDownloadableFileScanInput):PipelineRetryRepository {return {
 findScanTarget:(id)=>models.DownloadableFile.find({where:{id},selectionSet:RETRY_SELECTION_0}),
 findFailedAttempts:(where)=>models.PluginPipelineRun.find({where,selectionSet:RETRY_SELECTION_1}),
 findRetryJobs:(pipelineId)=>models.PluginRun.find({where:{pipelineId},selectionSet:RETRY_SELECTION_2}),
};}
