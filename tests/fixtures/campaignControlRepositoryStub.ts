import {PluginPipelineCampaignStatus,type PluginPipelineCampaignModel} from "../../ogm_types.js";
import type {CampaignControlRepository} from "../../services/persistence/campaignControlRepository.js";
export function campaignControlRepositoryStub(model:PluginPipelineCampaignModel):CampaignControlRepository {return {
 findActive:policyId=>model.find({where:{policyId,status_IN:[PluginPipelineCampaignStatus.Draft,PluginPipelineCampaignStatus.Running,PluginPipelineCampaignStatus.Paused]},selectionSet:`{ id }`}),
 create:input=>model.create({input}),
 findStatus:id=>model.find({where:{id},selectionSet:`{ id status }`}),
 updateStatus:(id,update)=>model.update({where:{id},update}),
};}
