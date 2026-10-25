import type { Driver } from "neo4j-driver";
import { createPluginRegistryRepository, type PluginRegistryRepository } from "../../services/persistence/pluginRegistryRepository.js";
import type {
  PluginCreateInput,
  PluginUpdateInput,
  PluginVersionCreateInput,
  PluginVersionUpdateInput
} from '../../ogm_types.js'
import type { GraphQLResolveInfo } from 'graphql'
import { getManifestArtifacts } from './shared/pluginManifest.js'
import type { GraphQLContext } from '../../types/context.js'
import { logger } from "../../logger.js";
import { fetchMergedPluginRegistry, type RegistryVersion } from '../../services/plugin/registryService.js'

type Input = { driver: Driver; pluginRegistryRepository?: PluginRegistryRepository }

const buildReleaseMetadataPayload = (registryVersion: RegistryVersion) => ({
  registryUrl: registryVersion.registryUrl || null,
  releaseNotesUrl: registryVersion.releaseNotesUrl || null,
  sourceRepoUrl: registryVersion.sourceRepoUrl || null,
  sourceCommit: registryVersion.sourceCommit || null,
  minServerVersion: registryVersion.minServerVersion || null,
  apiVersion: registryVersion.apiVersion || null
})


const getResolver = (input: Input, { fetchRegistry = fetchMergedPluginRegistry, readArtifacts = getManifestArtifacts }: { fetchRegistry?: typeof fetchMergedPluginRegistry; readArtifacts?: typeof getManifestArtifacts } = {}) => {
  const repository = input.pluginRegistryRepository ?? createPluginRegistryRepository(input.driver)

  return async (_parent: unknown, _args: unknown, _context: GraphQLContext, _resolveInfo: GraphQLResolveInfo) => {
    try {
      // Get the server config to find registry URLs
      const serverConfigs = await repository.findRegistryConfigs()

      logger.info('Found server configs:', serverConfigs.length)
      logger.info('Server config pluginRegistries:', serverConfigs[0]?.pluginRegistries)

      if (!serverConfigs.length || !serverConfigs[0].pluginRegistries?.length) {
        throw new Error('No plugin registries configured')
      }

      const registryUrls = (serverConfigs[0].pluginRegistries || [])
        .filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
      logger.info(`Fetching plugin registries from: ${registryUrls.join(', ')}`)
      const registryData = await fetchRegistry(registryUrls)

      logger.info(`Registry updated at: ${registryData.updatedAt}`)
      logger.info(`Found ${registryData.plugins.length} plugins in registry`)

      const updatedPlugins: any[] = []

      // First, find and fix any orphaned plugin versions that exist without Plugin connections
      logger.info('Checking for orphaned plugin versions...')
      
      try {
        const allVersions = await repository.findOrphanCandidates()

        logger.info(`Found ${allVersions.length} total plugin versions in database`)

        // Check each version to see if it has a Plugin relationship
        for (const version of allVersions) {
          try {
            // Use a more specific query that won't fail on null relationships
            // We'll try to find plugins that are connected to this version
            const connectedPlugins = await repository.findPluginsForVersion(version.id)

            if (connectedPlugins.length === 0) {
              logger.info(`Found orphaned version: ${version.version} (${version.repoUrl})`)
              
              // Try to match this version to a plugin from the registry
              for (const registryPlugin of registryData.plugins) {
                const matchingVersion = registryPlugin.versions.find(v => v.tarballUrl === version.repoUrl)
                if (matchingVersion) {
                  logger.info(`Attempting to connect orphaned version to plugin: ${registryPlugin.id}`)
                  
                  // Find or create the plugin
                  let plugins = await repository.findPluginDefaultByName(registryPlugin.id)

                  let plugin = plugins[0]
                  if (!plugin) {
                    logger.info(`Creating plugin for orphaned version: ${registryPlugin.id}`)
                    const createResult = await repository.createOrphanPlugin([{ name: registryPlugin.id }])
                    plugin = createResult.plugins[0]
                  }

                  // Connect the orphaned version to the plugin
                  await repository.connectOrphanVersion(version.id, plugin.id)
                  
                  logger.info(`Successfully connected orphaned version ${version.version} to plugin ${registryPlugin.id}`)
                  break
                }
              }
            }
          } catch (versionError: unknown) {
            const message = versionError instanceof Error ? versionError.message : String(versionError)
            logger.warn(`Skipping version ${version.id} due to error:`, message)
          }
        }
      } catch (orphanError: unknown) {
        const message = orphanError instanceof Error ? orphanError.message : String(orphanError)
        logger.warn('Error while checking orphaned versions:', message)
        // Continue with normal processing even if orphan check fails
      }

      logger.info('Finished checking orphaned versions, proceeding with registry processing...')


// Process each plugin in the registry
for (const registryPlugin of registryData.plugins) {
  let pluginRecord = (await repository.findPluginByName(registryPlugin.id))[0]

  let processedAnyVersion = false

  for (const registryVersion of registryPlugin.versions) {
    try {
      const artifacts = await readArtifacts(registryVersion.tarballUrl)
      logger.info(`Registry version: ${registryVersion.version}, Manifest version: ${artifacts.version}`)

      if (artifacts.id !== registryPlugin.id) {
        logger.warn(`Plugin ID mismatch: registry=${registryPlugin.id}, manifest=${artifacts.id}. Skipping.`)
        continue
      }

      type PluginManifestMetadata = {
        author?: { name?: string; url?: string }
        tags?: unknown[]
        homepage?: string
        license?: string
        [key: string]: unknown
      }
      type PluginManifest = {
        name?: string
        description?: string
        homepage?: string
        license?: string
        metadata?: PluginManifestMetadata
        [key: string]: unknown
      }
      const manifest = (artifacts.manifest || {}) as PluginManifest
      const metadata = (manifest.metadata || {}) as PluginManifestMetadata
      const author = metadata.author || {}
      const tags = Array.isArray(metadata.tags) ? metadata.tags : []
      const metadataValue =
        metadata && Object.keys(metadata).length > 0
          ? JSON.stringify(metadata)
          : null

      const pluginUpdatePayload = {
        displayName: manifest.name || registryPlugin.id,
        description: manifest.description || null,
        authorName: author.name || null,
        authorUrl: author.url || null,
        homepage: metadata.homepage || manifest.homepage || null,
        license: metadata.license || manifest.license || null,
        tags,
        metadata: metadataValue
      }

      if (!pluginRecord) {
        logger.info(`Creating new plugin: ${registryPlugin.id}`)
        const createResult = await repository.createRegistryPlugin([
            ({
              name: registryPlugin.id,
              displayName: pluginUpdatePayload.displayName,
              description: pluginUpdatePayload.description,
              authorName: pluginUpdatePayload.authorName,
              authorUrl: pluginUpdatePayload.authorUrl,
              homepage: pluginUpdatePayload.homepage,
              license: pluginUpdatePayload.license,
              tags: pluginUpdatePayload.tags,
              metadata: pluginUpdatePayload.metadata
            } as unknown as PluginCreateInput)
          ])
        pluginRecord = createResult.plugins[0]
      } else {
        await repository.updateRegistryPlugin(pluginRecord.id, ({
            displayName: { set: pluginUpdatePayload.displayName },
            description: { set: pluginUpdatePayload.description },
            authorName: { set: pluginUpdatePayload.authorName },
            authorUrl: { set: pluginUpdatePayload.authorUrl },
            homepage: { set: pluginUpdatePayload.homepage },
            license: { set: pluginUpdatePayload.license },
            tags: { set: pluginUpdatePayload.tags },
            metadata: { set: pluginUpdatePayload.metadata }
          } as unknown as PluginUpdateInput))
      }

      processedAnyVersion = true

      const existingVersions = await repository.findRegistryVersion(artifacts.version, registryVersion.tarballUrl)

      // Neo4j only accepts primitive types, so stringify nested objects
      const settingsDefaultsRaw = manifest.settingsDefaults ?? manifest.settings ?? null
      const uiSchemaRaw = manifest.ui ?? null
      const settingsDefaults = settingsDefaultsRaw ? JSON.stringify(settingsDefaultsRaw) : null
      const uiSchema = uiSchemaRaw ? JSON.stringify(uiSchemaRaw) : null
      const manifestJson = artifacts.manifest ? JSON.stringify(artifacts.manifest) : null
      const releaseMetadataPayload = buildReleaseMetadataPayload(registryVersion)

      if (existingVersions.length === 0) {
        logger.info(
          `Creating new plugin version: ${registryPlugin.id}@${artifacts.version} (registry: ${registryVersion.version})`
        )
        await repository.createRegistryVersion([
            ({
              version: artifacts.version,
              repoUrl: registryVersion.tarballUrl,
              tarballGsUri: registryVersion.tarballUrl,
              integritySha256: registryVersion.integritySha256,
              ...releaseMetadataPayload,
              entryPath: artifacts.entryPath || 'index.js',
              manifest: manifestJson,
              settingsDefaults,
              uiSchema,
              documentationPath: artifacts.readmePath ?? null,
              readmeMarkdown: artifacts.readmeMarkdown ?? null,
              Plugin: {
                connect: {
                  where: { node: { id: pluginRecord!.id } }
                }
              }
            } as unknown as PluginVersionCreateInput)
          ])
      } else {
        const existingVersion = existingVersions[0]
        logger.info(
          `Plugin version already exists: ${registryPlugin.id}@${artifacts.version}, ensuring connection`
        )

        await repository.updateRegistryVersion(existingVersion.id, ({
            tarballGsUri: { set: registryVersion.tarballUrl },
            integritySha256: { set: registryVersion.integritySha256 },
            ...Object.fromEntries(Object.entries(releaseMetadataPayload).map(([key, value]) => [key, { set: value }])),
            entryPath: { set: artifacts.entryPath || 'index.js' },
            manifest: { set: manifestJson },
            settingsDefaults: { set: settingsDefaults },
            uiSchema: { set: uiSchema },
            documentationPath: { set: artifacts.readmePath ?? null },
            readmeMarkdown: { set: artifacts.readmeMarkdown ?? null }
          } as unknown as PluginVersionUpdateInput), pluginRecord!.id)
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn(`Failed to process version ${registryVersion.version} for plugin ${registryPlugin.id}:`, message)
      continue
    }
  }

  if (pluginRecord && processedAnyVersion) {
    updatedPlugins.push(pluginRecord)
  }
}

      logger.info(`Successfully refreshed ${updatedPlugins.length} plugins`)
      
      // Before returning, make sure all plugins have their Versions relationship properly loaded
      const pluginsWithVersions = []
      for (const plugin of updatedPlugins) {
        try {
          const pluginWithVersions = await repository.findRegistryResult(plugin.id)
          
          if (pluginWithVersions[0]) {
            pluginsWithVersions.push(pluginWithVersions[0])
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error)
          logger.warn(`Could not load versions for plugin ${plugin.id}:`, message)
          // Still include the plugin but with empty versions array
          pluginsWithVersions.push({
            ...plugin,
            Versions: []
          })
        }
      }
      
      return pluginsWithVersions
    } catch (error: unknown) {
      logger.error('Error in refreshPlugins resolver:', error)
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to refresh plugins: ${message}`)
    }
  }
}

export default getResolver
