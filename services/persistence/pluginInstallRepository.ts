import type { Driver } from "neo4j-driver";
import type { Plugin, PluginVersion, ServerConfig, PluginCreateInput, PluginUpdateInput, PluginVersionCreateInput, PluginVersionUpdateInput } from "../../ogm_types.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
export const FINDINSTALLCONFIGS_SELECTION = `{
          serverName
          pluginRegistries
        }`;
export const FINDINSTALLPLUGIN_SELECTION = `{
          id
          name
          displayName
        }`;
export const FINDINSTALLVERSION_SELECTION = `{
          id
          version
          repoUrl
          tarballGsUri
          integritySha256
          registryUrl
          releaseNotesUrl
          sourceRepoUrl
          sourceCommit
          minServerVersion
          apiVersion
          entryPath
          Plugin {
            id
            name
          }
        }`;
export const CREATEINSTALLPLUGIN_SELECTION = `{ plugins {
  id
  name
  displayName
  description
  authorName
  authorUrl
  homepage
  license
  tags
  metadata
} }`;
export const UPDATEINSTALLPLUGIN_SELECTION = `{ plugins {
  id
  name
  displayName
  description
  authorName
  authorUrl
  homepage
  license
  tags
  metadata
} }`;
export const CREATEINSTALLVERSION_SELECTION = `{ pluginVersions {
  id
  version
  repoUrl
  tarballGsUri
  integritySha256
  registryUrl
  releaseNotesUrl
  sourceRepoUrl
  sourceCommit
  minServerVersion
  apiVersion
  entryPath
  documentationPath
  readmeMarkdown
  manifest
  settingsDefaults
  uiSchema
} }`;
export const UPDATEINSTALLVERSION_SELECTION = `{ pluginVersions {
  id
  version
  repoUrl
  tarballGsUri
  integritySha256
  registryUrl
  releaseNotesUrl
  sourceRepoUrl
  sourceCommit
  minServerVersion
  apiVersion
  entryPath
  documentationPath
  readmeMarkdown
  manifest
  settingsDefaults
  uiSchema
} }`;
export const FINDINSTALLEDVERSIONS_SELECTION = `{
          InstalledVersionsConnection {
            edges {
              properties {
                settingsJson
              }
              node {
                id
                version
                manifest
                Plugin {
                  id
                  name
                }
              }
            }
          }
        }`;
export const CONNECTINSTALLATION_SELECTION = `{ serverConfigs {
  serverName
  serverDescription
  serverIconURL
  allowedFileTypes
  featuredWikiPageIds
  enableDownloads
  enableEvents
  accountAgeGateEnabled
  minimumAccountAge
  sensitiveContentAgeGateEnabled
  minimumSensitiveContentAge
  brandingProductName
  brandingDocsURL
  brandingSourceURL
  brandingIssuesURL
  brandingSupportEmail
  brandingShowUpstreamLinks
  brandingLogoDarkURL
  brandingLogoAlt
  brandingFaviconURL
  brandingPrimaryColor
  pluginRegistries
  rules
  brandingCustomFooterLinks
  pluginPipelines
} }`;
export interface PluginInstallRepository {
  findInstallConfigs(): Promise<ServerConfig[]>;
  findInstallPlugin(pluginId: string): Promise<Plugin[]>;
  findInstallVersion(version: string, name: string): Promise<PluginVersion[]>;
  createInstallPlugin(input: PluginCreateInput[]): Promise<{plugins:Plugin[]}>;
  updateInstallPlugin(id: string, update: PluginUpdateInput): Promise<void>;
  createInstallVersion(input: PluginVersionCreateInput[]): Promise<{pluginVersions:PluginVersion[]}>;
  updateInstallVersion(id: string, update: PluginVersionUpdateInput, pluginId: string): Promise<void>;
  findInstalledVersions(serverName: string | null | undefined): Promise<ServerConfig[]>;
  connectInstallation(serverName: string, id: string, settingsJson: string | null): Promise<void>;
}
export function createPluginInstallRepository(driver: Driver): PluginInstallRepository {
  return {
    async findInstallConfigs() {
      const result = await executeGeneratedOperation<{serverConfigs:ServerConfig[]}>(driver,
        `query Install_findInstallConfigs { serverConfigs ${FINDINSTALLCONFIGS_SELECTION} }`, {});
      return result.serverConfigs;
    },
    async findInstallPlugin(pluginId) {
      const result = await executeGeneratedOperation<{plugins:Plugin[]}>(driver,
        `query Install_findInstallPlugin($where: PluginWhere) { plugins(where: $where) ${FINDINSTALLPLUGIN_SELECTION} }`, {where:{OR:[{id:{eq:pluginId}},{name:{eq:pluginId}}]}});
      return result.plugins;
    },
    async findInstallVersion(version, name) {
      const result = await executeGeneratedOperation<{pluginVersions:PluginVersion[]}>(driver,
        `query Install_findInstallVersion($where: PluginVersionWhere) { pluginVersions(where: $where) ${FINDINSTALLVERSION_SELECTION} }`, {where:{AND:[{version:{eq:version}},{Plugin:{name:{eq:name}}}]}});
      return result.pluginVersions;
    },
    async createInstallPlugin(input) {
      const result = await executeGeneratedOperation<{createPlugins:{plugins:Plugin[]}}>(driver,
        `mutation Install_createInstallPlugin($input: [PluginCreateInput!]!) { createPlugins(input: $input) ${CREATEINSTALLPLUGIN_SELECTION} }`, {input});
      return result.createPlugins;
    },
    async updateInstallPlugin(id, update) {
      await executeGeneratedOperation(driver,
        `mutation Install_updateInstallPlugin($where: PluginWhere, $update: PluginUpdateInput) { updatePlugins(where: $where, update: $update) ${UPDATEINSTALLPLUGIN_SELECTION} }`, {where:{id:{eq:id}},update});
    },
    async createInstallVersion(input) {
      // v7 removed the to-one Plugin connect from the create input; create the
      // version then own the HAS_VERSION edge ((:Plugin)-[:HAS_VERSION]->(:PluginVersion)).
      const { Plugin, ...scalars } = (input[0] ?? {}) as Record<string, any>;
      const pluginId = Plugin?.connect?.where?.node?.id ?? null;
      const result = await executeGeneratedOperation<{createPluginVersions:{pluginVersions:PluginVersion[]}}>(driver,
        `mutation Install_createInstallVersion($input: [PluginVersionCreateInput!]!) { createPluginVersions(input: $input) ${CREATEINSTALLVERSION_SELECTION} }`, {input:[scalars]});
      const versionId = result.createPluginVersions.pluginVersions[0]?.id;
      if (versionId && pluginId) {
        await driver.executeQuery(
          `MATCH (version:PluginVersion {id: $versionId})
           OPTIONAL MATCH (plugin:Plugin {id: $pluginId})
           FOREACH (_ IN CASE WHEN plugin IS NULL THEN [] ELSE [1] END | MERGE (plugin)-[:HAS_VERSION]->(version))`,
          {versionId, pluginId});
      }
      return result.createPluginVersions;
    },
    async updateInstallVersion(id, update, pluginId) {
      await executeGeneratedOperation(driver,
        `mutation Install_updateInstallVersion($where: PluginVersionWhere, $update: PluginVersionUpdateInput) { updatePluginVersions(where: $where, update: $update) ${UPDATEINSTALLVERSION_SELECTION} }`, {where:{id:{eq:id}},update});
      await driver.executeQuery(
        `MATCH (version:PluginVersion {id: $id})
         OPTIONAL MATCH (plugin:Plugin {id: $pluginId})
         FOREACH (_ IN CASE WHEN plugin IS NULL THEN [] ELSE [1] END | MERGE (plugin)-[:HAS_VERSION]->(version))`,
        {id, pluginId});
    },
    async findInstalledVersions(serverName) {
      const result = await executeGeneratedOperation<{serverConfigs:ServerConfig[]}>(driver,
        `query Install_findInstalledVersions($where: ServerConfigWhere) { serverConfigs(where: $where) ${FINDINSTALLEDVERSIONS_SELECTION} }`, {where:{serverName:{eq:serverName}}});
      return result.serverConfigs;
    },
    async connectInstallation(serverName, id, settingsJson) {
      await executeGeneratedOperation(driver,
        `mutation Install_connectInstallation($where: ServerConfigWhere, $update: ServerConfigUpdateInput) { updateServerConfigs(where: $where, update: $update) ${CONNECTINSTALLATION_SELECTION} }`, {where:{serverName:{eq:serverName}},update:{InstalledVersions:[{connect:[{where:{node:{id:{eq:id}}},edge:{enabled:false,settingsJson}}]}]}});
    },
  };
}
