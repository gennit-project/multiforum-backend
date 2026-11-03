import type {Driver} from "neo4j-driver";
import type {PluginPipelineRun} from "../../ogm_types.js";
import {executeGeneratedOperation} from "./generatedSchemaOperations.js";
import type {CampaignRow} from './campaignServiceRepository.js';
export type CampaignFailureRow = Pick<PluginPipelineRun,'pipelineId'|'targetId'|'status'|'attemptNumber'>;
export type CampaignDestinationRow = {id:string;Discussion:{id:string;DiscussionChannels:{channelUniqueName:string;archived:boolean|null}[]}|null};
export interface CampaignQueryRepository {
 findCampaigns():Promise<CampaignRow[]>;
 findFailures(campaignId:string):Promise<CampaignFailureRow[]>;
 findDestination(id:string):Promise<CampaignDestinationRow[]>;
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
 async findCampaigns(){const r=await executeGeneratedOperation<{pluginPipelineCampaigns:CampaignRow[]}>(driver,`query CampaignHistory {pluginPipelineCampaigns${CAMPAIGN_QUERY_SELECTION_0}}`,{});return r.pluginPipelineCampaigns;},
 async findFailures(campaignId){const r=await executeGeneratedOperation<{pluginPipelineRuns:CampaignFailureRow[]}>(driver,`query CampaignFailures($where:PluginPipelineRunWhere){pluginPipelineRuns(where:$where)${CAMPAIGN_QUERY_SELECTION_1}}`,{where:{campaignId:{eq:campaignId},status:{in:['FAILED','TIMED_OUT','CANCELLED']}}});return r.pluginPipelineRuns;},
 async findDestination(id){const r=await executeGeneratedOperation<{downloadableFiles:CampaignDestinationRow[]}>(driver,`query CampaignFailureDestination($where:DownloadableFileWhere){downloadableFiles(where:$where)${CAMPAIGN_QUERY_SELECTION_2}}`,{where:{id:{eq:id}}});return r.downloadableFiles;},
};}
