import type {Driver} from "neo4j-driver";
import type {PluginPipelineCampaign,PluginPipelineRun,DownloadableFile} from "../../ogm_types.js";
import {executeGeneratedOperation} from "./generatedSchemaOperations.js";
export interface CampaignQueryRepository {
 findCampaigns():Promise<PluginPipelineCampaign[]>;
 findFailures(campaignId:string):Promise<PluginPipelineRun[]>;
 findDestination(id:string):Promise<DownloadableFile[]>;
}
export const CAMPAIGN_QUERY_SELECTION_0 = `{
        id policyId eventType scope channelId applicability enforcementBehavior
        status concurrency rateLimitPerMinute affectedFileCount accessibleFileCount
        unavailableFileCount estimatedProviderRuns completedCount runningCount
        failedCount timedOutCount createdByUsername createdAt updatedAt startedAt
        pausedAt finishedAt
      }`;
export const CAMPAIGN_QUERY_SELECTION_1 = `{ pipelineId targetId status attemptNumber }`;
export const CAMPAIGN_QUERY_SELECTION_2 = `{
          id
          Discussion {
            id
            DiscussionChannels { channelUniqueName archived }
          }
        }`;
export function createCampaignQueryRepository(driver:Driver):CampaignQueryRepository {return {
 async findCampaigns(){const r=await executeGeneratedOperation<{pluginPipelineCampaigns:PluginPipelineCampaign[]}>(driver,`query CampaignHistory {pluginPipelineCampaigns${CAMPAIGN_QUERY_SELECTION_0}}`,{});return r.pluginPipelineCampaigns;},
 async findFailures(campaignId){const r=await executeGeneratedOperation<{pluginPipelineRuns:PluginPipelineRun[]}>(driver,`query CampaignFailures($where:PluginPipelineRunWhere){pluginPipelineRuns(where:$where)${CAMPAIGN_QUERY_SELECTION_1}}`,{where:{campaignId,status_IN:['FAILED','TIMED_OUT','CANCELLED']}});return r.pluginPipelineRuns;},
 async findDestination(id){const r=await executeGeneratedOperation<{downloadableFiles:DownloadableFile[]}>(driver,`query CampaignFailureDestination($where:DownloadableFileWhere){downloadableFiles(where:$where)${CAMPAIGN_QUERY_SELECTION_2}}`,{where:{id}});return r.downloadableFiles;},
};}
