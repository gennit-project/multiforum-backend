import type { Driver } from "neo4j-driver";
import type { Plugin, PluginVersion, ServerConfig, PluginCreateInput, PluginUpdateInput, PluginVersionCreateInput, PluginVersionUpdateInput } from "../../ogm_types.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
export const FINDREGISTRYCONFIGS_SELECTION = `{
          pluginRegistries
        }`;
export const FINDORPHANCANDIDATES_SELECTION = `{
            id
            version
            repoUrl
          }`;
export const FINDPLUGINSFORVERSION_SELECTION = `{
                id
                name
              }`;
export const FINDPLUGINDEFAULTBYNAME_SELECTION = `{
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
}`;
export const CREATEORPHANPLUGIN_SELECTION = `{ plugins {
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
export const CONNECTORPHANVERSION_SELECTION = `{ pluginVersions {
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
export const FINDPLUGINBYNAME_SELECTION = `{
      id
      name
    }`;
export const CREATEREGISTRYPLUGIN_SELECTION = `{ plugins {
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
export const UPDATEREGISTRYPLUGIN_SELECTION = `{ plugins {
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
export const FINDREGISTRYVERSION_SELECTION = `{
          id
          version
        }`;
export const CREATEREGISTRYVERSION_SELECTION = `{ pluginVersions {
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
export const UPDATEREGISTRYVERSION_SELECTION = `{ pluginVersions {
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
export const FINDREGISTRYRESULT_SELECTION = `{
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
              Versions {
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
                manifest
                settingsDefaults
                uiSchema
                documentationPath
                readmeMarkdown
              }
            }`;
export interface PluginRegistryRepository {
  findRegistryConfigs(): Promise<ServerConfig[]>;
  findOrphanCandidates(): Promise<PluginVersion[]>;
  findPluginsForVersion(versionId: string): Promise<Plugin[]>;
  findPluginDefaultByName(name: string): Promise<Plugin[]>;
  createOrphanPlugin(input: PluginCreateInput[]): Promise<{plugins:Plugin[]}>;
  connectOrphanVersion(id: string, pluginId: string): Promise<void>;
  findPluginByName(name: string): Promise<Plugin[]>;
  createRegistryPlugin(input: PluginCreateInput[]): Promise<{plugins:Plugin[]}>;
  updateRegistryPlugin(id: string, update: PluginUpdateInput): Promise<void>;
  findRegistryVersion(version: string, repoUrl: string): Promise<PluginVersion[]>;
  createRegistryVersion(input: PluginVersionCreateInput[]): Promise<void>;
  updateRegistryVersion(id: string, update: PluginVersionUpdateInput, pluginId: string): Promise<void>;
  findRegistryResult(id: string): Promise<Plugin[]>;
}
export function createPluginRegistryRepository(driver: Driver): PluginRegistryRepository {
  return {
    async findRegistryConfigs() {
      const result = await executeGeneratedOperation<{serverConfigs:ServerConfig[]}>(driver,
        `query Registry_findRegistryConfigs { serverConfigs ${FINDREGISTRYCONFIGS_SELECTION} }`, {});
      return result.serverConfigs;
    },
    async findOrphanCandidates() {
      const result = await executeGeneratedOperation<{pluginVersions:PluginVersion[]}>(driver,
        `query Registry_findOrphanCandidates { pluginVersions ${FINDORPHANCANDIDATES_SELECTION} }`, {});
      return result.pluginVersions;
    },
    async findPluginsForVersion(versionId) {
      const result = await executeGeneratedOperation<{plugins:Plugin[]}>(driver,
        `query Registry_findPluginsForVersion($where: PluginWhere) { plugins(where: $where) ${FINDPLUGINSFORVERSION_SELECTION} }`, {where:{Versions:{some:{id:{eq:versionId}}}}});
      return result.plugins;
    },
    async findPluginDefaultByName(name) {
      const result = await executeGeneratedOperation<{plugins:Plugin[]}>(driver,
        `query Registry_findPluginDefaultByName($where: PluginWhere) { plugins(where: $where) ${FINDPLUGINDEFAULTBYNAME_SELECTION} }`, {where:{name:{eq:name}}});
      return result.plugins;
    },
    async createOrphanPlugin(input) {
      const result = await executeGeneratedOperation<{createPlugins:{plugins:Plugin[]}}>(driver,
        `mutation Registry_createOrphanPlugin($input: [PluginCreateInput!]!) { createPlugins(input: $input) ${CREATEORPHANPLUGIN_SELECTION} }`, {input});
      return result.createPlugins;
    },
    async connectOrphanVersion(id, pluginId) {
      await executeGeneratedOperation(driver,
        `mutation Registry_connectOrphanVersion($where: PluginVersionWhere, $connect: PluginVersionConnectInput) { updatePluginVersions(where: $where, connect: $connect) ${CONNECTORPHANVERSION_SELECTION} }`, {where:{id:{eq:id}},connect:{Plugin:{where:{node:{id:pluginId}}}}});
    },
    async findPluginByName(name) {
      const result = await executeGeneratedOperation<{plugins:Plugin[]}>(driver,
        `query Registry_findPluginByName($where: PluginWhere) { plugins(where: $where) ${FINDPLUGINBYNAME_SELECTION} }`, {where:{name:{eq:name}}});
      return result.plugins;
    },
    async createRegistryPlugin(input) {
      const result = await executeGeneratedOperation<{createPlugins:{plugins:Plugin[]}}>(driver,
        `mutation Registry_createRegistryPlugin($input: [PluginCreateInput!]!) { createPlugins(input: $input) ${CREATEREGISTRYPLUGIN_SELECTION} }`, {input});
      return result.createPlugins;
    },
    async updateRegistryPlugin(id, update) {
      await executeGeneratedOperation(driver,
        `mutation Registry_updateRegistryPlugin($where: PluginWhere, $update: PluginUpdateInput) { updatePlugins(where: $where, update: $update) ${UPDATEREGISTRYPLUGIN_SELECTION} }`, {where:{id:{eq:id}},update});
    },
    async findRegistryVersion(version, repoUrl) {
      const result = await executeGeneratedOperation<{pluginVersions:PluginVersion[]}>(driver,
        `query Registry_findRegistryVersion($where: PluginVersionWhere) { pluginVersions(where: $where) ${FINDREGISTRYVERSION_SELECTION} }`, {where:{AND:[{version:{eq:version}},{repoUrl:{eq:repoUrl}}]}});
      return result.pluginVersions;
    },
    async createRegistryVersion(input) {
      await executeGeneratedOperation(driver,
        `mutation Registry_createRegistryVersion($input: [PluginVersionCreateInput!]!) { createPluginVersions(input: $input) ${CREATEREGISTRYVERSION_SELECTION} }`, {input});
    },
    async updateRegistryVersion(id, update, pluginId) {
      await executeGeneratedOperation(driver,
        `mutation Registry_updateRegistryVersion($where: PluginVersionWhere, $update: PluginVersionUpdateInput, $connect: PluginVersionConnectInput) { updatePluginVersions(where: $where, update: $update, connect: $connect) ${UPDATEREGISTRYVERSION_SELECTION} }`, {where:{id:{eq:id}},update,connect:{Plugin:{where:{node:{id:pluginId}}}}});
    },
    async findRegistryResult(id) {
      const result = await executeGeneratedOperation<{plugins:Plugin[]}>(driver,
        `query Registry_findRegistryResult($where: PluginWhere) { plugins(where: $where) ${FINDREGISTRYRESULT_SELECTION} }`, {where:{id:{eq:id}}});
      return result.plugins;
    },
  };
}
