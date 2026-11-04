import type { Driver } from "neo4j-driver";
import type { PluginConfigurationMutationResolvers, PluginConfigurationQueryResolvers, ConfigurationApplyResponse } from "../../customResolvers/contracts/pluginConfiguration.js";
import preview from "../../customResolvers/queries/previewPluginConfigurationReconciliation.js";
import apply from "../../customResolvers/mutations/applyPluginConfiguration.js";
import type { ReconciliationConfigSnapshot, ReconciliationInstalledEdge } from "../../services/persistence/pluginConfigurationReadRepository.js";
declare const driver:Driver;
const queries={previewPluginConfigurationReconciliation:preview({driver})} satisfies PluginConfigurationQueryResolvers;
const mutations={applyPluginConfiguration:apply({})} satisfies PluginConfigurationMutationResolvers;
const plan={apiVersion:"v1",inSync:true,changes:[],warnings:[]};
const valid:ConfigurationApplyResponse={status:"NO_CHANGES",message:"No change",planBefore:plan,planAfter:plan,operations:[]};
// @ts-expect-error nested plan inSync must be Boolean
const wrongNested:ConfigurationApplyResponse={...valid,planAfter:{...plan,inSync:"true"}};
// @ts-expect-error unknown result status is not a generated enum value
const wrongStatus:ConfigurationApplyResponse={...valid,status:"OK"};
// @ts-expect-error operation kind must be a generated change kind
const wrongOperation:ConfigurationApplyResponse={...valid,operations:[{kind:"OTHER",status:"APPLIED",path:"path",message:"message"}]};
// @ts-expect-error response plan must include its changes array
const missingPlan:PluginConfigurationQueryResolvers["previewPluginConfigurationReconciliation"]=()=>({apiVersion:"v1",inSync:true,warnings:[]});
// @ts-expect-error exact connection projection requires properties
const missingProperties:ReconciliationInstalledEdge={node:{version:"1",Plugin:null}};
declare const config:ReconciliationConfigSnapshot;
// @ts-expect-error unrelated ServerConfig fields were not fetched
config.serverDescription;
// @ts-expect-error secret ciphertext is never fetched
config.InstalledVersionsConnection.edges[0].node.ciphertext;
void [queries,mutations,valid,wrongNested,wrongStatus,wrongOperation,missingPlan,missingProperties];
