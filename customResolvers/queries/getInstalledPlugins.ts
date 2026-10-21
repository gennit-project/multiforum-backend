import type { Driver } from "neo4j-driver";
import { createPluginConfigurationReadRepository, type PluginConfigurationReadRepository, type InstalledPluginEdge } from "../../services/persistence/pluginConfigurationReadRepository.js";
import type { GraphQLResolveInfo } from 'graphql'
import type { GraphQLContext } from '../../types/context.js'
import { logger } from "../../logger.js";
import { compareVersions, fetchMergedPluginRegistry, findLatestVersion } from '../../services/plugin/registryService.js'

type Input = {
  driver: Driver
  pluginConfigurationReadRepository?: PluginConfigurationReadRepository
}


const getResolver = (input: Input) => {
  const repository = input.pluginConfigurationReadRepository ?? createPluginConfigurationReadRepository(input.driver)

  return async (_parent: unknown, _args: unknown, _context: GraphQLContext, _resolveInfo: GraphQLResolveInfo) => {
    try {
      // Get server config with installed plugins using Connection pattern
      // This gives us access to relationship properties (enabled, settingsJson)
      const serverConfigs = await repository.listInstalledPluginConfigs()

      if (!serverConfigs.length) {
        return []
      }

      const serverConfig = serverConfigs[0] as {
        pluginRegistries?: string[]
        InstalledVersionsConnection?: { edges?: InstalledPluginEdge[] }
      }
      const edges = serverConfig.InstalledVersionsConnection?.edges || []

      if (!edges.length) {
        return []
      }

      // Try to fetch registry for version comparison
      let registryVersionsMap = new Map<string, string[]>()
      const registryUrls = serverConfig.pluginRegistries || []
      if (registryUrls.length) {
        try {
          const registryData = await fetchMergedPluginRegistry(registryUrls)
          registryVersionsMap = new Map(
            registryData.plugins.map((plugin) => [
              plugin.id,
              plugin.versions.map((version) => version.version)
            ])
          )
        } catch (error) {
          // Registry fetch failed - continue without version comparison
          logger.warn('Failed to fetch plugin registry for version comparison:', error instanceof Error ? error.message : String(error))
        }
      }

      const installedPlugins = edges.map((edgeData: InstalledPluginEdge) => {
        const edgeProps = edgeData.properties || {}
        const node = edgeData.node || {}
        const pluginData = node.Plugin || {}
        const pluginName = pluginData.name
        const installedVersion = node.version

        // Get version info from registry
        const availableVersions = registryVersionsMap.get(pluginName ?? "") || []
        const latestVersion = findLatestVersion(availableVersions)
        const hasUpdate = latestVersion
          ? compareVersions(latestVersion, installedVersion ?? "") > 0
          : false

        return {
          plugin: {
            id: pluginData.id,
            name: pluginData.name,
            displayName: pluginData.displayName,
            description: pluginData.description,
            authorName: pluginData.authorName,
            authorUrl: pluginData.authorUrl,
            homepage: pluginData.homepage,
            license: pluginData.license,
            tags: pluginData.tags || [],
            metadata: pluginData.metadata || null
          },
          version: installedVersion,
          scope: 'SERVER',
          enabled: edgeProps.enabled ?? false,
          settingsJson: edgeProps.settingsJson
            ? (typeof edgeProps.settingsJson === 'string'
              ? JSON.parse(edgeProps.settingsJson)
              : edgeProps.settingsJson)
            : {},
          // Parse JSON strings back to objects (these are stored as strings in Neo4j)
          manifest: node.manifest ? (typeof node.manifest === 'string' ? JSON.parse(node.manifest) : node.manifest) : null,
          settingsDefaults: node.settingsDefaults ? (typeof node.settingsDefaults === 'string' ? JSON.parse(node.settingsDefaults) : node.settingsDefaults) : null,
          uiSchema: node.uiSchema ? (typeof node.uiSchema === 'string' ? JSON.parse(node.uiSchema) : node.uiSchema) : null,
          documentationPath: node.documentationPath || null,
          readmeMarkdown: node.readmeMarkdown || null,
          registryUrl: node.registryUrl || null,
          releaseNotesUrl: node.releaseNotesUrl || null,
          sourceRepoUrl: node.sourceRepoUrl || null,
          sourceCommit: node.sourceCommit || null,
          minServerVersion: node.minServerVersion || null,
          apiVersion: node.apiVersion || null,
          hasUpdate,
          latestVersion,
          availableVersions: availableVersions.sort((a, b) => compareVersions(b, a)) // sorted newest first
        }
      })

      return installedPlugins

    } catch (error) {
      logger.error('Error in getInstalledPlugins resolver:', error)
      throw new Error(`Failed to get installed plugins: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

export default getResolver
