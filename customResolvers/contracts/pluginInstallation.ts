import type { MutationResolvers } from "../../src/generated/graphql.js";
import type { GraphQLContext } from "../../types/context.js";
import type { SelectedResolver } from "./selection.js";
import { ENABLEMENT_PLUGINSelection } from "./pluginInstallationProjections.js";
const { Versions: _versions, ...pluginMetadataSelection } = ENABLEMENT_PLUGINSelection;
export const enabledPluginSelection = {
  plugin:pluginMetadataSelection,version:true,scope:true,enabled:true,settingsJson:true,
  manifest:true,settingsDefaults:true,uiSchema:true,documentationPath:true,readmeMarkdown:true,
  registryUrl:true,releaseNotesUrl:true,sourceRepoUrl:true,sourceCommit:true,minServerVersion:true,apiVersion:true,
} as const;
// Installation metadata originates in fetched manifest assertions; only these
// constructed/coerced fields are certified, not that external metadata.
export const installedPluginSelection = {plugin:{id:true,name:true},version:true,scope:true,enabled:true,settingsJson:true,carryOverReport:true} as const;
// A failed final refetch returns the earlier id/name lookup with Versions: [].
export const refreshedPluginSelection = {id:true,name:true,Versions:{id:true,version:true}} as const;
export const pluginInstallationMutationNames = ["enableServerPlugin","installPluginVersion","refreshPlugins"] as const;
export type PluginInstallationMutationResolvers = {
 enableServerPlugin: SelectedResolver<MutationResolvers<GraphQLContext>["enableServerPlugin"],typeof enabledPluginSelection>;
 installPluginVersion: SelectedResolver<MutationResolvers<GraphQLContext>["installPluginVersion"],typeof installedPluginSelection>;
 refreshPlugins: SelectedResolver<MutationResolvers<GraphQLContext>["refreshPlugins"],typeof refreshedPluginSelection>;
};
