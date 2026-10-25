import type {Driver} from "neo4j-driver";
import type {DownloadableFile,Discussion,Channel,ServerConfig,PluginPipelineRun,PluginPipelineRunWhere} from "../../ogm_types.js";
import {executeGeneratedOperation} from "./generatedSchemaOperations.js";
export interface PipelineStartRepository {
 findFileTarget(id:string):Promise<DownloadableFile[]>;
 findDiscussionTarget(id:string):Promise<Discussion[]>;
 findChannelPlan(uniqueName:string|undefined):Promise<Channel[]>;
 findServerPlan():Promise<ServerConfig[]>;
 findActiveAttempts(where:PluginPipelineRunWhere):Promise<PluginPipelineRun[]>;
 findStartedAttempt(pipelineId:string):Promise<PluginPipelineRun[]>;
}
export const START_SELECTION_0 = `{
          id
          uploadedAt
          createdAt
          uploadedByUsername
          Discussion {
            Author { username }
            DiscussionChannels {
              channelUniqueName
              archived
            }
          }
        }`;
export const START_SELECTION_1 = `{
          id
          Author { username }
          DownloadableFile {
            uploadedAt
            createdAt
            uploadedByUsername
          }
          DiscussionChannels {
            channelUniqueName
            archived
          }
        }`;
export const START_SELECTION_2 = `{ uniqueName pluginPipelines }`;
export const START_SELECTION_3 = `{
        pluginPipelines
        InstalledVersionsConnection {
          edges {
            properties { enabled settingsJson }
            node {
              id version repoUrl tarballGsUri entryPath manifest
              settingsDefaults uiSchema
              Plugin {
                id name displayName description metadata
              }
            }
          }
        }
      }`;
export const START_SELECTION_4 = `{ pipelineId }`;
export const START_SELECTION_5 = `{
        pipelineId targetId targetType targetVersion eventType scope channelId status trigger
        initiatedByUsername retryOfPipelineRunId attemptNumber
        configurationSnapshot applicability policyEffectiveAt policyId campaignId
        queuedAt startedAt heartbeatAt timeoutAt finishedAt createdAt updatedAt
      }`;
export function createPipelineStartRepository(driver:Driver):PipelineStartRepository { return {
 async findFileTarget(id){const r=await executeGeneratedOperation<{downloadableFiles:DownloadableFile[]}>(driver,`query StartPipelineFindFileTarget($where:DownloadableFileWhere){downloadableFiles(where:$where)${START_SELECTION_0}}`,{where:{id:{eq:id}}});return r.downloadableFiles;},
 async findDiscussionTarget(id){const r=await executeGeneratedOperation<{discussions:Discussion[]}>(driver,`query StartPipelineFindDiscussionTarget($where:DiscussionWhere){discussions(where:$where)${START_SELECTION_1}}`,{where:{id:{eq:id}}});return r.discussions;},
 async findChannelPlan(uniqueName){const r=await executeGeneratedOperation<{channels:Channel[]}>(driver,`query StartPipelineFindChannelPlan($where:ChannelWhere){channels(where:$where)${START_SELECTION_2}}`,{where:{uniqueName:{eq:uniqueName}}});return r.channels;},
 async findServerPlan(){const r=await executeGeneratedOperation<{serverConfigs:ServerConfig[]}>(driver,`query StartPipelineFindServerPlan{serverConfigs${START_SELECTION_3}}`,{});return r.serverConfigs;},
 async findActiveAttempts(where){const r=await executeGeneratedOperation<{pluginPipelineRuns:PluginPipelineRun[]}>(driver,`query StartPipelineFindActiveAttempts($where:PluginPipelineRunWhere){pluginPipelineRuns(where:$where)${START_SELECTION_4}}`,{where});return r.pluginPipelineRuns;},
 async findStartedAttempt(pipelineId){const r=await executeGeneratedOperation<{pluginPipelineRuns:PluginPipelineRun[]}>(driver,`query StartPipelineFindStartedAttempt($where:PluginPipelineRunWhere){pluginPipelineRuns(where:$where)${START_SELECTION_5}}`,{where:{pipelineId:{eq:pipelineId}}});return r.pluginPipelineRuns;},
};}
