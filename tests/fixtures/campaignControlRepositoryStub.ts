import {PluginPipelineCampaignStatus,type PluginPipelineCampaignModel} from "../../ogm_types.js";
import type {CampaignControlRepository} from "../../services/persistence/campaignControlRepository.js";
export function campaignControlRepositoryStub(model:PluginPipelineCampaignModel):CampaignControlRepository {return {
 async transitionStatus(id,status){
  const current=(await model.find({where:{id},selectionSet:`{id status}`}))[0];
  if(!current)return {kind:"missing"};
  const expected=status===PluginPipelineCampaignStatus.Paused?PluginPipelineCampaignStatus.Running:PluginPipelineCampaignStatus.Paused;
  if(current.status!==expected)return {kind:"invalid"};
  const result=await model.update({where:{id},update:{status:{set:status},pausedAt:{set:status===PluginPipelineCampaignStatus.Paused?new Date().toISOString():null}}});
  return {kind:"updated",campaign:result.pluginPipelineCampaigns[0]};
 },
 findActive:policyId=>model.find({where:{policyId,status_IN:[PluginPipelineCampaignStatus.Draft,PluginPipelineCampaignStatus.Running,PluginPipelineCampaignStatus.Paused]},selectionSet:`{ id }`}),
 create:input=>model.create({input}),
 findStatus:id=>model.find({where:{id},selectionSet:`{ id status }`}),
 updateStatus:(id,update)=>model.update({where:{id},update}),
};}
