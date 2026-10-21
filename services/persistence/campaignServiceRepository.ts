import type {Driver} from "neo4j-driver";
import type {ServerConfig,DownloadableFile,PluginPipelineRun,PluginPipelineCampaign,PluginPipelineCampaignUpdateInput} from "../../ogm_types.js";
import {executeGeneratedOperation} from "./generatedSchemaOperations.js";
export interface CampaignServiceRepository {
 findPolicies():Promise<ServerConfig[]>;
 findFiles():Promise<DownloadableFile[]>;
 findAttempts(campaignId:string):Promise<PluginPipelineRun[]>;
 updateProgress(id:string,update:PluginPipelineCampaignUpdateInput):Promise<void>;
 findRunningCampaigns():Promise<PluginPipelineCampaign[]>;
}
export const POLICY_SELECTION = `{ pluginPipelines }`;
export const FILE_SELECTION = `{ id url uploadedAt createdAt permanentlyRemoved }`;
export const ATTEMPT_SELECTION = `{ targetId status createdAt }`;
export const RUNNING_SELECTION = `{
      id policyId eventType scope channelId applicability enforcementBehavior
      status concurrency rateLimitPerMinute affectedFileCount accessibleFileCount
      unavailableFileCount estimatedProviderRuns completedCount runningCount
      failedCount timedOutCount createdByUsername createdAt updatedAt startedAt
      pausedAt finishedAt
    }`;
export const CAMPAIGN_DEFAULT_SELECTION = `{
  id
  policyId
  eventType
  scope
  channelId
  enforcementBehavior
  concurrency
  rateLimitPerMinute
  affectedFileCount
  accessibleFileCount
  unavailableFileCount
  estimatedProviderRuns
  completedCount
  runningCount
  failedCount
  timedOutCount
  createdByUsername
  applicability
  status
  createdAt
  updatedAt
  startedAt
  pausedAt
  finishedAt
}`;
export function createCampaignServiceRepository(driver:Driver):CampaignServiceRepository {return {
 async findPolicies(){const r=await executeGeneratedOperation<{serverConfigs:ServerConfig[]}>(driver,`query CampaignPolicies {serverConfigs${POLICY_SELECTION}}`,{});return r.serverConfigs;},
 async findFiles(){const r=await executeGeneratedOperation<{downloadableFiles:DownloadableFile[]}>(driver,`query CampaignFiles {downloadableFiles${FILE_SELECTION}}`,{});return r.downloadableFiles;},
 async findAttempts(campaignId){const r=await executeGeneratedOperation<{pluginPipelineRuns:PluginPipelineRun[]}>(driver,`query CampaignAttemptStates($where:PluginPipelineRunWhere){pluginPipelineRuns(where:$where)${ATTEMPT_SELECTION}}`,{where:{campaignId}});return r.pluginPipelineRuns;},
 async updateProgress(id,update){await executeGeneratedOperation(driver,`mutation UpdateCampaignProgress($where:PluginPipelineCampaignWhere,$update:PluginPipelineCampaignUpdateInput){updatePluginPipelineCampaigns(where:$where,update:$update){pluginPipelineCampaigns${CAMPAIGN_DEFAULT_SELECTION}}}`,{where:{id},update});},
 async findRunningCampaigns(){const r=await executeGeneratedOperation<{pluginPipelineCampaigns:PluginPipelineCampaign[]}>(driver,`query RunningPipelineCampaigns($where:PluginPipelineCampaignWhere){pluginPipelineCampaigns(where:$where)${RUNNING_SELECTION}}`,{where:{status:'RUNNING'}});return r.pluginPipelineCampaigns;},
};}
