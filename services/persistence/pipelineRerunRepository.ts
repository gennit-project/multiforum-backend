import type {Driver} from "neo4j-driver";
import type {DownloadableFile,Discussion,PluginPipelineRun,PluginPipelineRunWhere} from "../../ogm_types.js";
import {executeGeneratedOperation} from "./generatedSchemaOperations.js";
export interface PipelineRerunRepository {
 findSourceAttempt(pipelineId:string):Promise<PluginPipelineRun[]>;
 findFileVersion(id:string):Promise<DownloadableFile[]>;
 findDiscussionVersion(id:string):Promise<Discussion[]>;
 findRelatedAttempts(where:PluginPipelineRunWhere):Promise<PluginPipelineRun[]>;
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
 async findSourceAttempt(pipelineId){const r=await executeGeneratedOperation<{pluginPipelineRuns:PluginPipelineRun[]}>(driver,`query RerunPipelineFindSourceAttempt($where:PluginPipelineRunWhere){pluginPipelineRuns(where:$where)${RERUN_SELECTION_0}}`,{where:{pipelineId:{eq:pipelineId}}});return r.pluginPipelineRuns;},
 async findFileVersion(id){const r=await executeGeneratedOperation<{downloadableFiles:DownloadableFile[]}>(driver,`query RerunPipelineFindFileVersion($where:DownloadableFileWhere){downloadableFiles(where:$where)${RERUN_SELECTION_1}}`,{where:{id:{eq:id}}});return r.downloadableFiles;},
 async findDiscussionVersion(id){const r=await executeGeneratedOperation<{discussions:Discussion[]}>(driver,`query RerunPipelineFindDiscussionVersion($where:DiscussionWhere){discussions(where:$where)${RERUN_SELECTION_2}}`,{where:{id:{eq:id}}});return r.discussions;},
 async findRelatedAttempts(where){const r=await executeGeneratedOperation<{pluginPipelineRuns:PluginPipelineRun[]}>(driver,`query RerunPipelineFindRelatedAttempts($where:PluginPipelineRunWhere){pluginPipelineRuns(where:$where)${RERUN_SELECTION_3}}`,{where});return r.pluginPipelineRuns;},
};}
