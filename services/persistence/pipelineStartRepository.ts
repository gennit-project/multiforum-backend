import type {ActiveAttempt} from "../../customResolvers/contracts/pluginExecutionProjections.js";
import type { StartFileTarget, StartDiscussionTarget, StartChannelPlan, StartServerPlan, StartedAttempt } from "../../customResolvers/contracts/pluginExecutionProjections.js";
import type {Driver} from "neo4j-driver";
import type {PluginPipelineRunWhere} from "../../ogm_types.js";
import {executeGeneratedOperation} from "./generatedSchemaOperations.js";
export interface PipelineStartRepository {
 findFileTarget(id:string):Promise<StartFileTarget[]>;
 findDiscussionTarget(id:string):Promise<StartDiscussionTarget[]>;
 findChannelPlan(uniqueName:string|undefined):Promise<StartChannelPlan[]>;
 findServerPlan():Promise<StartServerPlan[]>;
 findActiveAttempts(where:PluginPipelineRunWhere):Promise<ActiveAttempt[]>;
 findStartedAttempt(pipelineId:string):Promise<StartedAttempt[]>;
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
          title
          body
          Author { username }
          DownloadableFiles(limit: 1) {
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
 async findFileTarget(id){const r=await executeGeneratedOperation<{downloadableFiles:StartFileTarget[]}>(driver,`query StartPipelineFindFileTarget($where:DownloadableFileWhere){downloadableFiles(where:$where)${START_SELECTION_0}}`,{where:{id:{eq:id}}});return r.downloadableFiles;},
 async findDiscussionTarget(id){const r=await executeGeneratedOperation<{discussions:StartDiscussionTarget[]}>(driver,`query StartPipelineFindDiscussionTarget($where:DiscussionWhere){discussions(where:$where)${START_SELECTION_1}}`,{where:{id:{eq:id}}});return r.discussions;},
 async findChannelPlan(uniqueName){const r=await executeGeneratedOperation<{channels:StartChannelPlan[]}>(driver,`query StartPipelineFindChannelPlan($where:ChannelWhere){channels(where:$where)${START_SELECTION_2}}`,{where:{uniqueName:{eq:uniqueName}}});return r.channels;},
 async findServerPlan(){const r=await executeGeneratedOperation<{serverConfigs:StartServerPlan[]}>(driver,`query StartPipelineFindServerPlan{serverConfigs${START_SELECTION_3}}`,{});return r.serverConfigs;},
 async findActiveAttempts(where){const r=await executeGeneratedOperation<{pluginPipelineRuns:ActiveAttempt[]}>(driver,`query StartPipelineFindActiveAttempts($where:PluginPipelineRunWhere){pluginPipelineRuns(where:$where)${START_SELECTION_4}}`,{where});return r.pluginPipelineRuns;},
 async findStartedAttempt(pipelineId){const r=await executeGeneratedOperation<{pluginPipelineRuns:StartedAttempt[]}>(driver,`query StartPipelineFindStartedAttempt($where:PluginPipelineRunWhere){pluginPipelineRuns(where:$where)${START_SELECTION_5}}`,{where:{pipelineId:{eq:pipelineId}}});return r.pluginPipelineRuns;},
};}
