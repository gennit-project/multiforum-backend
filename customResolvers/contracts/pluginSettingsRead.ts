import type { QueryResolvers, InstalledPlugin, PluginConfigStatus } from "../../src/generated/graphql.js";
import type { GraphQLContext } from "../../types/context.js";
import type { Selection, SelectedResolver } from "./selection.js";
export const installedPluginSelection = {
  version: true, scope: true, enabled: true,
  documentationPath: true, readmeMarkdown: true, registryUrl: true,
  releaseNotesUrl: true, sourceRepoUrl: true, sourceCommit: true,
  minServerVersion: true, apiVersion: true, hasUpdate: true,
  latestVersion: true, availableVersions: true,
  plugin: { displayName: true, description: true, authorName: true, authorUrl: true, homepage: true, license: true, tags: true },
} as const satisfies Selection<InstalledPlugin>;
// Plugin.id/name are deliberately not selected: orphan versions still yield
// undefined identities and fail only when a caller selects those non-null fields.
export const pluginConfigStatusSelection = {
  isFullyConfigured: true,
  fields: { key: true, label: true, scope: true, kind: true, required: true, isSet: true, isValid: true, message: true },
} as const satisfies Selection<PluginConfigStatus>;
export type PluginSettingsReadResolvers = {
  getInstalledPlugins: SelectedResolver<QueryResolvers<GraphQLContext>["getInstalledPlugins"], typeof installedPluginSelection>;
  getPluginConfigStatus: SelectedResolver<QueryResolvers<GraphQLContext>["getPluginConfigStatus"], typeof pluginConfigStatusSelection>;
};
export const pluginSettingsReadNames = ["getInstalledPlugins", "getPluginConfigStatus"] as const;
