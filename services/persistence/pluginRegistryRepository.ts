import type { FINDORPHANCANDIDATESProjection, CREATEORPHANPLUGINProjection, CREATEREGISTRYPLUGINProjection, FINDPLUGINBYNAMEProjection, FINDPLUGINDEFAULTBYNAMEProjection, FINDPLUGINSFORVERSIONProjection, FINDREGISTRYCONFIGSProjection, FINDREGISTRYRESULTProjection, FINDREGISTRYVERSIONProjection } from "../../customResolvers/contracts/pluginInstallationProjections.js";
import type { Driver } from "neo4j-driver";
import type { PluginCreateInput, PluginUpdateInput, PluginVersionCreateInput, PluginVersionUpdateInput } from "../../ogm_types.js";
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
  findRegistryConfigs(): Promise<FINDREGISTRYCONFIGSProjection[]>;
  findOrphanCandidates(): Promise<FINDORPHANCANDIDATESProjection[]>;
  findPluginsForVersion(versionId: string): Promise<FINDPLUGINSFORVERSIONProjection[]>;
  findPluginDefaultByName(name: string): Promise<FINDPLUGINDEFAULTBYNAMEProjection[]>;
  createOrphanPlugin(input: PluginCreateInput[]): Promise<{plugins:CREATEORPHANPLUGINProjection[]}>;
  connectOrphanVersion(id: string, pluginId: string): Promise<void>;
  findPluginByName(name: string): Promise<FINDPLUGINBYNAMEProjection[]>;
  createRegistryPlugin(input: PluginCreateInput[]): Promise<{plugins:CREATEREGISTRYPLUGINProjection[]}>;
  updateRegistryPlugin(id: string, update: PluginUpdateInput): Promise<void>;
  findRegistryVersion(version: string, repoUrl: string): Promise<FINDREGISTRYVERSIONProjection[]>;
  createRegistryVersion(input: PluginVersionCreateInput[]): Promise<void>;
  updateRegistryVersion(id: string, update: PluginVersionUpdateInput, pluginId: string): Promise<void>;
  findRegistryResult(id: string): Promise<FINDREGISTRYRESULTProjection[]>;
}
export function createPluginRegistryRepository(driver: Driver): PluginRegistryRepository {
  return {
    async findRegistryConfigs() {
      const result = await executeGeneratedOperation<{serverConfigs:FINDREGISTRYCONFIGSProjection[]}>(driver,
        `query Registry_findRegistryConfigs { serverConfigs ${FINDREGISTRYCONFIGS_SELECTION} }`, {});
      return result.serverConfigs;
    },
    async findOrphanCandidates() {
      const result = await executeGeneratedOperation<{pluginVersions:FINDORPHANCANDIDATESProjection[]}>(driver,
        `query Registry_findOrphanCandidates { pluginVersions ${FINDORPHANCANDIDATES_SELECTION} }`, {});
      return result.pluginVersions;
    },
    async findPluginsForVersion(versionId) {
      const result = await executeGeneratedOperation<{plugins:FINDPLUGINSFORVERSIONProjection[]}>(driver,
        `query Registry_findPluginsForVersion($where: PluginWhere) { plugins(where: $where) ${FINDPLUGINSFORVERSION_SELECTION} }`, {where:{Versions:{some:{id:{eq:versionId}}}}});
      return result.plugins;
    },
    async findPluginDefaultByName(name) {
      const result = await executeGeneratedOperation<{plugins:FINDPLUGINDEFAULTBYNAMEProjection[]}>(driver,
        `query Registry_findPluginDefaultByName($where: PluginWhere) { plugins(where: $where) ${FINDPLUGINDEFAULTBYNAME_SELECTION} }`, {where:{name:{eq:name}}});
      return result.plugins;
    },
    async createOrphanPlugin(input) {
      const result = await executeGeneratedOperation<{createPlugins:{plugins:CREATEORPHANPLUGINProjection[]}}>(driver,
        `mutation Registry_createOrphanPlugin($input: [PluginCreateInput!]!) { createPlugins(input: $input) ${CREATEORPHANPLUGIN_SELECTION} }`, {input});
      return result.createPlugins;
    },
    async connectOrphanVersion(id, pluginId) {
      // v7 removed the to-one connect; own the HAS_VERSION edge
      // ((:Plugin)-[:HAS_VERSION]->(:PluginVersion)).
      await driver.executeQuery(
        `MATCH (version:PluginVersion {id: $id})
         OPTIONAL MATCH (plugin:Plugin {id: $pluginId})
         FOREACH (_ IN CASE WHEN plugin IS NULL THEN [] ELSE [1] END | MERGE (plugin)-[:HAS_VERSION]->(version))`,
        {id, pluginId});
    },
    async findPluginByName(name) {
      const result = await executeGeneratedOperation<{plugins:FINDPLUGINBYNAMEProjection[]}>(driver,
        `query Registry_findPluginByName($where: PluginWhere) { plugins(where: $where) ${FINDPLUGINBYNAME_SELECTION} }`, {where:{name:{eq:name}}});
      return result.plugins;
    },
    async createRegistryPlugin(input) {
      const result = await executeGeneratedOperation<{createPlugins:{plugins:CREATEREGISTRYPLUGINProjection[]}}>(driver,
        `mutation Registry_createRegistryPlugin($input: [PluginCreateInput!]!) { createPlugins(input: $input) ${CREATEREGISTRYPLUGIN_SELECTION} }`, {input});
      return result.createPlugins;
    },
    async updateRegistryPlugin(id, update) {
      await executeGeneratedOperation(driver,
        `mutation Registry_updateRegistryPlugin($where: PluginWhere, $update: PluginUpdateInput) { updatePlugins(where: $where, update: $update) ${UPDATEREGISTRYPLUGIN_SELECTION} }`, {where:{id:{eq:id}},update});
    },
    async findRegistryVersion(version, repoUrl) {
      const result = await executeGeneratedOperation<{pluginVersions:FINDREGISTRYVERSIONProjection[]}>(driver,
        `query Registry_findRegistryVersion($where: PluginVersionWhere) { pluginVersions(where: $where) ${FINDREGISTRYVERSION_SELECTION} }`, {where:{AND:[{version:{eq:version}},{repoUrl:{eq:repoUrl}}]}});
      return result.pluginVersions;
    },
    async createRegistryVersion(input) {
      // v7 removed the to-one Plugin connect from the create input; create the
      // version, then own the HAS_VERSION edge.
      const { Plugin, ...scalars } = (input[0] ?? {}) as Record<string, any>;
      const pluginId = Plugin?.connect?.where?.node?.id ?? null;
      const result = await executeGeneratedOperation<{createPluginVersions:{pluginVersions:Array<{id:string}>}}>(driver,
        `mutation Registry_createRegistryVersion($input: [PluginVersionCreateInput!]!) { createPluginVersions(input: $input) ${CREATEREGISTRYVERSION_SELECTION} }`, {input:[scalars]});
      const versionId = result.createPluginVersions.pluginVersions[0]?.id;
      if (versionId && pluginId) {
        await driver.executeQuery(
          `MATCH (version:PluginVersion {id: $versionId})
           OPTIONAL MATCH (plugin:Plugin {id: $pluginId})
           FOREACH (_ IN CASE WHEN plugin IS NULL THEN [] ELSE [1] END | MERGE (plugin)-[:HAS_VERSION]->(version))`,
          {versionId, pluginId});
      }
    },
    async updateRegistryVersion(id, update, pluginId) {
      await executeGeneratedOperation(driver,
        `mutation Registry_updateRegistryVersion($where: PluginVersionWhere, $update: PluginVersionUpdateInput) { updatePluginVersions(where: $where, update: $update) ${UPDATEREGISTRYVERSION_SELECTION} }`, {where:{id:{eq:id}},update});
      // v7 removed the top-level connect arg; own the HAS_VERSION edge.
      await driver.executeQuery(
        `MATCH (version:PluginVersion {id: $id})
         OPTIONAL MATCH (plugin:Plugin {id: $pluginId})
         FOREACH (_ IN CASE WHEN plugin IS NULL THEN [] ELSE [1] END | MERGE (plugin)-[:HAS_VERSION]->(version))`,
        {id, pluginId});
    },
    async findRegistryResult(id) {
      const result = await executeGeneratedOperation<{plugins:FINDREGISTRYRESULTProjection[]}>(driver,
        `query Registry_findRegistryResult($where: PluginWhere) { plugins(where: $where) ${FINDREGISTRYRESULT_SELECTION} }`, {where:{id:{eq:id}}});
      return result.plugins;
    },
  };
}
