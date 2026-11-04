import type { RetryScanTarget, RetryFailedAttempt, ReturnedJob } from "../../customResolvers/contracts/pluginExecutionProjections.js";
import type {Driver} from "neo4j-driver";
import type {PluginPipelineRunWhere} from "../../ogm_types.js";
import {executeGeneratedOperation} from "./generatedSchemaOperations.js";
export interface PipelineRetryRepository {
 findScanTarget(id:string):Promise<RetryScanTarget[]>;
 findFailedAttempts(where:PluginPipelineRunWhere):Promise<RetryFailedAttempt[]>;
 findRetryJobs(pipelineId:string):Promise<ReturnedJob[]>;
}
export const RETRY_SELECTION_0 = `{
        uploadedByUsername
        scanStatus
        Discussion {
          id
          Author { username }
          DiscussionChannels {
            channelUniqueName
            archived
          }
        }
      }`;
export const RETRY_SELECTION_1 = `{ pipelineId createdAt }`;
export const RETRY_SELECTION_2 = `{
          id pluginId pluginName version scope channelId eventType status message
          durationMs targetId targetType payload pipelineId executionOrder
          skippedReason createdAt updatedAt
        }`;
export function createPipelineRetryRepository(driver:Driver):PipelineRetryRepository { return {
 async findScanTarget(id){const r=await executeGeneratedOperation<{downloadableFiles:RetryScanTarget[]}>(driver,`query RetryPipelineFindScanTarget($where:DownloadableFileWhere){downloadableFiles(where:$where)${RETRY_SELECTION_0}}`,{where:{id:{eq:id}}});return r.downloadableFiles;},
 async findFailedAttempts(where){const r=await executeGeneratedOperation<{pluginPipelineRuns:RetryFailedAttempt[]}>(driver,`query RetryPipelineFindFailedAttempts($where:PluginPipelineRunWhere){pluginPipelineRuns(where:$where)${RETRY_SELECTION_1}}`,{where});return r.pluginPipelineRuns;},
 async findRetryJobs(pipelineId){const r=await executeGeneratedOperation<{pluginRuns:ReturnedJob[]}>(driver,`query RetryPipelineFindRetryJobs($where:PluginRunWhere){pluginRuns(where:$where)${RETRY_SELECTION_2}}`,{where:{pipelineId:{eq:pipelineId}}});return r.pluginRuns;},
};}
