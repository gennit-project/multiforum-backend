import type { MutationResolvers, QueryResolvers, PluginConfigurationApplyResult } from "../../src/generated/graphql.js";
import type { GraphQLContext } from "../../types/context.js";
import type { Projection, SelectedResolver } from "./selection.js";

// Entire custom response structure; arbitrary current/desired JSON remains owned
// by the JSON scalar rather than narrowed to a guessed configuration schema.
export const reconciliationPlanSelection = {
  apiVersion:true,inSync:true,warnings:true,
  changes:{kind:true,path:true,message:true,current:true,desired:true,blocked:true},
} as const;
export const configurationApplySelection = {
  status:true,message:true,planBefore:reconciliationPlanSelection,planAfter:reconciliationPlanSelection,
  operations:{kind:true,path:true,status:true,message:true},
} as const;
export type ConfigurationApplyResponse = Projection<PluginConfigurationApplyResult,typeof configurationApplySelection>;
export const pluginConfigurationQueryNames = ["previewPluginConfigurationReconciliation"] as const;
export const pluginConfigurationMutationNames = ["applyPluginConfiguration"] as const;
export type PluginConfigurationQueryResolvers = {
  previewPluginConfigurationReconciliation: SelectedResolver<QueryResolvers<GraphQLContext>["previewPluginConfigurationReconciliation"],typeof reconciliationPlanSelection>;
};
export type PluginConfigurationMutationResolvers = {
  applyPluginConfiguration: SelectedResolver<MutationResolvers<GraphQLContext>["applyPluginConfiguration"],typeof configurationApplySelection>;
};
