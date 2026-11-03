import type {Driver} from "neo4j-driver";
import type {ServerConfig,DownloadableFile,PluginPipelineRun,PluginPipelineCampaign,PluginPipelineCampaignUpdateInput} from "../../ogm_types.js";
import {executeGeneratedOperation} from "./generatedSchemaOperations.js";
// Fixed selections executed and serialized by the generated schema.
export type CampaignRow = Required<Pick<PluginPipelineCampaign,
  'id'|'policyId'|'eventType'|'scope'|'channelId'|'applicability'|'enforcementBehavior'|
  'status'|'concurrency'|'rateLimitPerMinute'|'affectedFileCount'|'accessibleFileCount'|
  'unavailableFileCount'|'estimatedProviderRuns'|'completedCount'|'runningCount'|
  'failedCount'|'timedOutCount'|'createdByUsername'|'createdAt'|'updatedAt'|'startedAt'|'pausedAt'|'finishedAt'>>;
export type CampaignPolicyRow = Required<Pick<ServerConfig,'pluginPipelines'>>;
export type CampaignFileRow = Required<Pick<DownloadableFile,'id'|'url'|'uploadedAt'|'createdAt'|'permanentlyRemoved'>>;
export type CampaignAttemptRow = Required<Pick<PluginPipelineRun,'targetId'|'status'|'createdAt'>>;
export interface CampaignServiceRepository {
 findPolicies():Promise<CampaignPolicyRow[]>;
 findFiles():Promise<CampaignFileRow[]>;
 findAttempts(campaignId:string):Promise<CampaignAttemptRow[]>;
 updateProgress(id:string,update:PluginPipelineCampaignUpdateInput):Promise<void>;
 findRunningCampaigns():Promise<CampaignRow[]>;
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
 async findPolicies(){const r=await executeGeneratedOperation<{serverConfigs:CampaignPolicyRow[]}>(driver,`query CampaignPolicies {serverConfigs${POLICY_SELECTION}}`,{});return r.serverConfigs;},
 // Sort explicitly: the batch processes these files in result order (and the
 // @limit default selects a subset), so an unordered read would make both the
 // processing order and the selected subset depend on Neo4j's unspecified row
 // order. Oldest-first with an id tiebreak keeps it deterministic.
 async findFiles(){const r=await executeGeneratedOperation<{downloadableFiles:CampaignFileRow[]}>(driver,`query CampaignFiles {downloadableFiles(sort: [{createdAt: ASC}, {id: ASC}])${FILE_SELECTION}}`,{});return r.downloadableFiles;},
 async findAttempts(campaignId){const r=await executeGeneratedOperation<{pluginPipelineRuns:CampaignAttemptRow[]}>(driver,`query CampaignAttemptStates($where:PluginPipelineRunWhere){pluginPipelineRuns(where:$where)${ATTEMPT_SELECTION}}`,{where:{campaignId:{eq:campaignId}}});return r.pluginPipelineRuns;},
 async updateProgress(id,update){await executeGeneratedOperation(driver,`mutation UpdateCampaignProgress($where:PluginPipelineCampaignWhere,$update:PluginPipelineCampaignUpdateInput){updatePluginPipelineCampaigns(where:$where,update:$update){pluginPipelineCampaigns${CAMPAIGN_DEFAULT_SELECTION}}}`,{where:{id:{eq:id}},update});},
 async findRunningCampaigns(){const r=await executeGeneratedOperation<{pluginPipelineCampaigns:CampaignRow[]}>(driver,`query RunningPipelineCampaigns($where:PluginPipelineCampaignWhere){pluginPipelineCampaigns(where:$where)${RUNNING_SELECTION}}`,{where:{status:{eq:'RUNNING'}}});return r.pluginPipelineCampaigns;},
};}
