import type {RerunRelatedAttempt} from "../../customResolvers/contracts/pluginExecutionProjections.js";
import type { FileVersion, RerunDiscussionVersion, RerunSourceAttempt } from "../../customResolvers/contracts/pluginExecutionProjections.js";
import type {Driver} from "neo4j-driver";
import type {PluginPipelineRunWhere} from "../../ogm_types.js";
import {executeGeneratedOperation} from "./generatedSchemaOperations.js";
export interface PipelineRerunRepository {
 findSourceAttempt(pipelineId:string):Promise<RerunSourceAttempt[]>;
 findFileVersion(id:string):Promise<FileVersion[]>;
 findDiscussionVersion(id:string):Promise<RerunDiscussionVersion[]>;
 findRelatedAttempts(where:PluginPipelineRunWhere):Promise<RerunRelatedAttempt[]>;
}
export const RERUN_SELECTION_0 = `{
        pipelineId targetId targetType targetVersion eventType scope channelId
        status trigger createdAt
      }`;
export const RERUN_SELECTION_1 = `{ uploadedAt createdAt }`;
export const RERUN_SELECTION_2 = `{
            DownloadableFile { uploadedAt createdAt }
          }`;
export const RERUN_SELECTION_3 = `{ pipelineId status trigger createdAt }`;
export function createPipelineRerunRepository(driver:Driver):PipelineRerunRepository { return {
 async findSourceAttempt(pipelineId){const r=await executeGeneratedOperation<{pluginPipelineRuns:RerunSourceAttempt[]}>(driver,`query RerunPipelineFindSourceAttempt($where:PluginPipelineRunWhere){pluginPipelineRuns(where:$where)${RERUN_SELECTION_0}}`,{where:{pipelineId:{eq:pipelineId}}});return r.pluginPipelineRuns;},
 async findFileVersion(id){const r=await executeGeneratedOperation<{downloadableFiles:FileVersion[]}>(driver,`query RerunPipelineFindFileVersion($where:DownloadableFileWhere){downloadableFiles(where:$where)${RERUN_SELECTION_1}}`,{where:{id:{eq:id}}});return r.downloadableFiles;},
 async findDiscussionVersion(id){const r=await executeGeneratedOperation<{discussions:RerunDiscussionVersion[]}>(driver,`query RerunPipelineFindDiscussionVersion($where:DiscussionWhere){discussions(where:$where)${RERUN_SELECTION_2}}`,{where:{id:{eq:id}}});return r.discussions;},
 async findRelatedAttempts(where){const r=await executeGeneratedOperation<{pluginPipelineRuns:RerunRelatedAttempt[]}>(driver,`query RerunPipelineFindRelatedAttempts($where:PluginPipelineRunWhere){pluginPipelineRuns(where:$where)${RERUN_SELECTION_3}}`,{where});return r.pluginPipelineRuns;},
};}
