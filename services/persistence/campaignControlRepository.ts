import type {Driver} from "neo4j-driver";
import {PluginPipelineCampaignStatus, type PluginPipelineCampaign,type PluginPipelineCampaignCreateInput,type PluginPipelineCampaignUpdateInput} from "../../ogm_types.js";
import {executeGeneratedOperation} from "./generatedSchemaOperations.js";
import {CAMPAIGN_DEFAULT_SELECTION,type CampaignRow} from "./campaignServiceRepository.js";
import {lockCampaignStatus} from "./campaignStatusLock.js";
export type CampaignIdentityRow = Pick<PluginPipelineCampaign,'id'>;
export type CampaignStatusRow = Pick<PluginPipelineCampaign,'id'|'status'>;
export type CampaignTransitionTarget = PluginPipelineCampaignStatus.Paused | PluginPipelineCampaignStatus.Running;
export type CampaignTransitionResult =
 | {kind:"missing"}
 | {kind:"invalid"}
 | {kind:"conflict"; status:unknown}
 | {kind:"updated"; campaign:CampaignRow};
export interface CampaignControlRepository {
 transitionStatus(id:string,status:CampaignTransitionTarget):Promise<CampaignTransitionResult>;
 findActive(policyId:string):Promise<CampaignIdentityRow[]>;
 create(input:PluginPipelineCampaignCreateInput[]):Promise<{pluginPipelineCampaigns:CampaignRow[]}>;
 findStatus(id:string):Promise<CampaignStatusRow[]>;
 updateStatus(id:string,update:PluginPipelineCampaignUpdateInput):Promise<{pluginPipelineCampaigns:CampaignRow[]}>;
}
export function createCampaignControlRepository(driver:Driver):CampaignControlRepository {return {
 async transitionStatus(id,status){
  const session=driver.session();
  try {
   const snapshot=await session.run<{status:unknown;version:string|null;identity:string}>(`MATCH (campaign:PluginPipelineCampaign {id:$id}) RETURN campaign.status AS status,toString(campaign.updatedAt) AS version,elementId(campaign) AS identity`,{id});
   const before=snapshot.records[0];
   if(!before)return {kind:"missing"};
   const expected=status===PluginPipelineCampaignStatus.Paused
     ? PluginPipelineCampaignStatus.Running : PluginPipelineCampaignStatus.Paused;
   if(before.get("status")!==expected)return {kind:"invalid"};
   const outcome=await session.executeWrite(async transaction=>{
    const current=await lockCampaignStatus(transaction,id);
    if(!current)return {kind:"missing"} as const;
    if(current.status!==expected || current.version!==before.get("version") || current.identity!==before.get("identity")){
     return {kind:"conflict",status:current.status} as const;
    }
    try {
     const r=await executeGeneratedOperation<{updatePluginPipelineCampaigns:{pluginPipelineCampaigns:CampaignRow[]}}>(driver,
       `mutation TransitionCampaignStatus($where:PluginPipelineCampaignWhere,$update:PluginPipelineCampaignUpdateInput){updatePluginPipelineCampaigns(where:$where,update:$update){pluginPipelineCampaigns${CAMPAIGN_DEFAULT_SELECTION}}}`,
       {where:{id:{eq:id},status:{eq:expected}},update:{status:{set:status},pausedAt:{set:status===PluginPipelineCampaignStatus.Paused?new Date().toISOString():null}}},transaction);
     const campaign=r.updatePluginPipelineCampaigns.pluginPipelineCampaigns[0];
     if(!campaign)throw new Error("Campaign transition did not return the updated campaign");
     return {kind:"updated",campaign} as const;
    } catch(error) {
     // Preserve the generated mutation's existing commit-before-field-projection
     // behavior. A database error still prevents commit; a response resolver
     // error is rethrown only after the successful write transaction commits.
     return {kind:"response-error",error} as const;
    }
   });
   if(outcome.kind==="response-error")throw outcome.error;
   return outcome;
  } finally {await session.close();}
 },
 async findActive(policyId){const r=await executeGeneratedOperation<{pluginPipelineCampaigns:CampaignIdentityRow[]}>(driver,`query ActivePolicyCampaigns($where:PluginPipelineCampaignWhere){pluginPipelineCampaigns(where:$where){id}}`,{where:{policyId:{eq:policyId},status:{in:['DRAFT','RUNNING','PAUSED']}}});return r.pluginPipelineCampaigns;},
 async create(input){const r=await executeGeneratedOperation<{createPluginPipelineCampaigns:{pluginPipelineCampaigns:CampaignRow[]}}>(driver,`mutation CreatePolicyCampaign($input:[PluginPipelineCampaignCreateInput!]!){createPluginPipelineCampaigns(input:$input){pluginPipelineCampaigns${CAMPAIGN_DEFAULT_SELECTION}}}`,{input});return r.createPluginPipelineCampaigns;},
 async findStatus(id){const r=await executeGeneratedOperation<{pluginPipelineCampaigns:CampaignStatusRow[]}>(driver,`query CampaignStatus($where:PluginPipelineCampaignWhere){pluginPipelineCampaigns(where:$where){id status}}`,{where:{id:{eq:id}}});return r.pluginPipelineCampaigns;},
 async updateStatus(id,update){const r=await executeGeneratedOperation<{updatePluginPipelineCampaigns:{pluginPipelineCampaigns:CampaignRow[]}}>(driver,`mutation ChangeCampaignStatus($where:PluginPipelineCampaignWhere,$update:PluginPipelineCampaignUpdateInput){updatePluginPipelineCampaigns(where:$where,update:$update){pluginPipelineCampaigns${CAMPAIGN_DEFAULT_SELECTION}}}`,{where:{id:{eq:id}},update});return r.updatePluginPipelineCampaigns;},
};}
