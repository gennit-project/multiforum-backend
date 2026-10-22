import {PluginPipelineCampaignStatus,SortDirection} from "../../ogm_types.js";
import type {ModelMap} from "../../ogm_types.js";
import type {CampaignServiceRepository} from "../../services/persistence/campaignServiceRepository.js";
import {POLICY_SELECTION,FILE_SELECTION,ATTEMPT_SELECTION,RUNNING_SELECTION} from "../../services/persistence/campaignServiceRepository.js";
export function campaignServiceRepositoryStub(models:Pick<ModelMap,'DownloadableFile'|'ServerConfig'> & Partial<Pick<ModelMap,'PluginPipelineRun'|'PluginPipelineCampaign'>>):CampaignServiceRepository {return {
 findPolicies:()=>models.ServerConfig.find({selectionSet:POLICY_SELECTION}),
 findFiles:()=>models.DownloadableFile.find({selectionSet:FILE_SELECTION,options:{sort:[{createdAt:SortDirection.Asc},{id:SortDirection.Asc}]}}),
 findAttempts:campaignId=>models.PluginPipelineRun!.find({where:{campaignId},selectionSet:ATTEMPT_SELECTION}),
 updateProgress:async(id,update)=>{await models.PluginPipelineCampaign!.update({where:{id},update});},
 findRunningCampaigns:()=>models.PluginPipelineCampaign!.find({where:{status:PluginPipelineCampaignStatus.Running},selectionSet:RUNNING_SELECTION}),
};}
