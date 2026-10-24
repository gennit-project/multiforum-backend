import type {Driver} from "neo4j-driver";
import type {PluginPipelineCampaign,PluginPipelineCampaignCreateInput,PluginPipelineCampaignUpdateInput} from "../../ogm_types.js";
import {executeGeneratedOperation} from "./generatedSchemaOperations.js";
import {CAMPAIGN_DEFAULT_SELECTION} from "./campaignServiceRepository.js";
export interface CampaignControlRepository {
 findActive(policyId:string):Promise<PluginPipelineCampaign[]>;
 create(input:PluginPipelineCampaignCreateInput[]):Promise<{pluginPipelineCampaigns:PluginPipelineCampaign[]}>;
 findStatus(id:string):Promise<PluginPipelineCampaign[]>;
 updateStatus(id:string,update:PluginPipelineCampaignUpdateInput):Promise<{pluginPipelineCampaigns:PluginPipelineCampaign[]}>;
}
export function createCampaignControlRepository(driver:Driver):CampaignControlRepository {return {
 async findActive(policyId){const r=await executeGeneratedOperation<{pluginPipelineCampaigns:PluginPipelineCampaign[]}>(driver,`query ActivePolicyCampaigns($where:PluginPipelineCampaignWhere){pluginPipelineCampaigns(where:$where){id}}`,{where:{policyId:{eq:policyId},status:{in:['DRAFT','RUNNING','PAUSED']}}});return r.pluginPipelineCampaigns;},
 async create(input){const r=await executeGeneratedOperation<{createPluginPipelineCampaigns:{pluginPipelineCampaigns:PluginPipelineCampaign[]}}>(driver,`mutation CreatePolicyCampaign($input:[PluginPipelineCampaignCreateInput!]!){createPluginPipelineCampaigns(input:$input){pluginPipelineCampaigns${CAMPAIGN_DEFAULT_SELECTION}}}`,{input});return r.createPluginPipelineCampaigns;},
 async findStatus(id){const r=await executeGeneratedOperation<{pluginPipelineCampaigns:PluginPipelineCampaign[]}>(driver,`query CampaignStatus($where:PluginPipelineCampaignWhere){pluginPipelineCampaigns(where:$where){id status}}`,{where:{id:{eq:id}}});return r.pluginPipelineCampaigns;},
 async updateStatus(id,update){const r=await executeGeneratedOperation<{updatePluginPipelineCampaigns:{pluginPipelineCampaigns:PluginPipelineCampaign[]}}>(driver,`mutation ChangeCampaignStatus($where:PluginPipelineCampaignWhere,$update:PluginPipelineCampaignUpdateInput){updatePluginPipelineCampaigns(where:$where,update:$update){pluginPipelineCampaigns${CAMPAIGN_DEFAULT_SELECTION}}}`,{where:{id:{eq:id}},update});return r.updatePluginPipelineCampaigns;},
};}
