import type { Driver } from "neo4j-driver";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";

export type PluginSecretStatusSnapshot = {
  key: string;
  isValid: boolean | null;
  lastValidatedAt: string | null;
  validationError: string | null;
};
export type ReconciliationSecretSnapshot = {
  pluginId: string;
  key: string;
  isValid: boolean | null;
  lastValidatedAt: string | null;
};
export type InstalledPluginEdge = {
  properties?: {
    enabled?: boolean
    settingsJson?: string | Record<string, unknown>
  }
  node?: {
    version?: string
    manifest?: string | Record<string, unknown> | null
    settingsDefaults?: string | Record<string, unknown> | null
    uiSchema?: string | Record<string, unknown> | null
    documentationPath?: string | null
    readmeMarkdown?: string | null
    registryUrl?: string | null
    releaseNotesUrl?: string | null
    sourceRepoUrl?: string | null
    sourceCommit?: string | null
    minServerVersion?: string | null
    apiVersion?: string | null
    Plugin?: {
      id?: string
      name?: string
      displayName?: string
      description?: string
      authorName?: string
      authorUrl?: string
      homepage?: string
      license?: string
      tags?: string[]
      metadata?: unknown
    }
    [key: string]: unknown
  }
}

export type InstalledPluginConfigSnapshot = {
  serverName?: string | null;
  pluginRegistries?: string[] | null;
  InstalledVersionsConnection?: { edges?: InstalledPluginEdge[] };
};
export type ReconciliationConfigSnapshot = {
  serverName?: string | null;
  pluginRegistries?: string[] | null;
  pluginPipelines?: unknown;
  InstalledVersionsConnection?: { edges?: Array<{
    properties?: { enabled?: boolean | null; settingsJson?: unknown } | null;
    node?: { version?: string | null; Plugin?: { name?: string | null } | null } | null;
  }> };
};
export type ReconciliationChannelSnapshot = {
  uniqueName?: string | null;
  EnabledPluginsConnection?: { edges?: Array<{
    properties?: { enabled?: boolean | null; settingsJson?: unknown } | null;
    node?: { version?: string | null; Plugin?: { name?: string | null } | null } | null;
  }> };
};

export interface PluginConfigurationReadRepository {
  listPluginSecretStatuses(pluginId: string): Promise<PluginSecretStatusSnapshot[]>;
  listInstalledPluginConfigs(): Promise<InstalledPluginConfigSnapshot[]>;
  listReconciliationConfigs(): Promise<ReconciliationConfigSnapshot[]>;
  listReconciliationChannels?(uniqueNames: string[]): Promise<ReconciliationChannelSnapshot[]>;
  listReconciliationSecretStatuses(): Promise<ReconciliationSecretSnapshot[]>;
}

const PLUGIN_SECRET_STATUSES = `query PluginSecretStatuses($where: ServerSecretWhere) { serverSecrets(where: $where) {
          key
          isValid
          lastValidatedAt
          validationError
        } }`;

const INSTALLED_PLUGIN_CONFIGS = `query InstalledPluginConfiguration { serverConfigs {
          serverName
          pluginRegistries
          InstalledVersionsConnection {
            edges {
              properties {
                enabled
                settingsJson
              }
              node {
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
                Plugin {
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
                }
              }
            }
          }
        } }`;

const RECONCILIATION_CONFIGS = `query PluginConfigurationReconciliationSnapshot { serverConfigs {
        serverName
        pluginRegistries
        pluginPipelines
        InstalledVersionsConnection {
          edges {
            properties { enabled settingsJson }
            node { version Plugin { name } }
          }
        }
      } }`;

const RECONCILIATION_CHANNELS = `query PluginConfigurationReconciliationChannels($where: ChannelWhere) { channels(where: $where) {
        uniqueName
        EnabledPluginsConnection {
          edges {
            properties { enabled settingsJson }
            node { version Plugin { name } }
          }
        }
      } }`;

const RECONCILIATION_SECRET_STATUSES = `query PluginConfigurationReconciliationSecrets { serverSecrets { pluginId key isValid lastValidatedAt } }`;

/** Read-only configuration projections. Secret ciphertext is never selected. */
export function createPluginConfigurationReadRepository(driver: Driver): PluginConfigurationReadRepository {
  return {
    async listPluginSecretStatuses(pluginId) {
      const data = await executeGeneratedOperation<{ serverSecrets: PluginSecretStatusSnapshot[] }>(
        driver, PLUGIN_SECRET_STATUSES, { where: { pluginId } }
      );
      return data.serverSecrets;
    },
    async listInstalledPluginConfigs() {
      const data = await executeGeneratedOperation<{ serverConfigs: InstalledPluginConfigSnapshot[] }>(
        driver, INSTALLED_PLUGIN_CONFIGS, {}
      );
      return data.serverConfigs;
    },
    async listReconciliationConfigs() {
      const data = await executeGeneratedOperation<{ serverConfigs: ReconciliationConfigSnapshot[] }>(
        driver, RECONCILIATION_CONFIGS, {}
      );
      return data.serverConfigs;
    },
    async listReconciliationChannels(uniqueNames) {
      if (uniqueNames.length === 0) return [];
      const data = await executeGeneratedOperation<{ channels: ReconciliationChannelSnapshot[] }>(
        driver, RECONCILIATION_CHANNELS, { where: { uniqueName_IN: uniqueNames } }
      );
      return data.channels;
    },
    async listReconciliationSecretStatuses() {
      const data = await executeGeneratedOperation<{ serverSecrets: ReconciliationSecretSnapshot[] }>(
        driver, RECONCILIATION_SECRET_STATUSES, {}
      );
      return data.serverSecrets;
    },
  };
}
