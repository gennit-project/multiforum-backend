import type {Driver} from "neo4j-driver";
import type {PluginPipelineCampaign,PluginPipelineCampaignCreateInput,PluginPipelineCampaignUpdateInput} from "../../ogm_types.js";
import {executeGeneratedOperation} from "./generatedSchemaOperations.js";
import {CAMPAIGN_DEFAULT_SELECTION,type CampaignRow} from "./campaignServiceRepository.js";
export type CampaignIdentityRow = Pick<PluginPipelineCampaign,'id'>;
export type CampaignStatusRow = Pick<PluginPipelineCampaign,'id'|'status'>;
export interface CampaignControlRepository {
 findActive(policyId:string):Promise<CampaignIdentityRow[]>;
 create(input:PluginPipelineCampaignCreateInput[]):Promise<{pluginPipelineCampaigns:CampaignRow[]}>;
 findStatus(id:string):Promise<CampaignStatusRow[]>;
 updateStatus(id:string,update:PluginPipelineCampaignUpdateInput):Promise<{pluginPipelineCampaigns:CampaignRow[]}>;
}
export function createCampaignControlRepository(driver:Driver):CampaignControlRepository {return {
 async findActive(policyId){const r=await executeGeneratedOperation<{pluginPipelineCampaigns:CampaignIdentityRow[]}>(driver,`query ActivePolicyCampaigns($where:PluginPipelineCampaignWhere){pluginPipelineCampaigns(where:$where){id}}`,{where:{policyId:{eq:policyId},status:{in:['DRAFT','RUNNING','PAUSED']}}});return r.pluginPipelineCampaigns;},
 async create(input){const r=await executeGeneratedOperation<{createPluginPipelineCampaigns:{pluginPipelineCampaigns:CampaignRow[]}}>(driver,`mutation CreatePolicyCampaign($input:[PluginPipelineCampaignCreateInput!]!){createPluginPipelineCampaigns(input:$input){pluginPipelineCampaigns${CAMPAIGN_DEFAULT_SELECTION}}}`,{input});return r.createPluginPipelineCampaigns;},
 async findStatus(id){const r=await executeGeneratedOperation<{pluginPipelineCampaigns:CampaignStatusRow[]}>(driver,`query CampaignStatus($where:PluginPipelineCampaignWhere){pluginPipelineCampaigns(where:$where){id status}}`,{where:{id:{eq:id}}});return r.pluginPipelineCampaigns;},
 async updateStatus(id,update){const r=await executeGeneratedOperation<{updatePluginPipelineCampaigns:{pluginPipelineCampaigns:CampaignRow[]}}>(driver,`mutation ChangeCampaignStatus($where:PluginPipelineCampaignWhere,$update:PluginPipelineCampaignUpdateInput){updatePluginPipelineCampaigns(where:$where,update:$update){pluginPipelineCampaigns${CAMPAIGN_DEFAULT_SELECTION}}}`,{where:{id:{eq:id}},update});return r.updatePluginPipelineCampaigns;},
};}
