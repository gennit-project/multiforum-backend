import {PluginPipelineRunStatus} from "../../ogm_types.js";
import type {ModelMap} from "../../ogm_types.js";
import type {CampaignQueryRepository} from "../../services/persistence/campaignQueryRepository.js";
import {CAMPAIGN_QUERY_SELECTION_0,CAMPAIGN_QUERY_SELECTION_1,CAMPAIGN_QUERY_SELECTION_2} from "../../services/persistence/campaignQueryRepository.js";
export function campaignQueryRepositoryStub(models:Partial<Pick<ModelMap,'PluginPipelineCampaign'|'PluginPipelineRun'|'DownloadableFile'>>):CampaignQueryRepository{return {
 findCampaigns:()=>models.PluginPipelineCampaign!.find({selectionSet:CAMPAIGN_QUERY_SELECTION_0}),
 findFailures:campaignId=>models.PluginPipelineRun!.find({where:{campaignId,status_IN:[PluginPipelineRunStatus.Failed,PluginPipelineRunStatus.TimedOut,PluginPipelineRunStatus.Cancelled]},selectionSet:CAMPAIGN_QUERY_SELECTION_1}),
 findDestination:id=>models.DownloadableFile!.find({where:{id},selectionSet:CAMPAIGN_QUERY_SELECTION_2}),
};}
