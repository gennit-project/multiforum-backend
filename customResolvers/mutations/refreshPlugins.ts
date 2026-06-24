import type {
  PluginModel,
  PluginVersionModel,
  ServerConfigModel,
  PluginCreateInput,
  PluginUpdateInput,
  PluginVersionCreateInput,
  PluginVersionUpdateInput
} from '../../ogm_types.js'
import { Storage } from '@google-cloud/storage'
import type { GraphQLResolveInfo } from 'graphql'
import { getManifestArtifacts } from './shared/pluginManifest.js'
import type { GraphQLContext } from '../../types/context.js'
import { logger } from "../../logger.js";

type RegistryPlugin = {
  id: string
  versions: {
    version: string
    tarballUrl: string
    integritySha256: string
  }[]
}

type PluginRegistry = {
  updatedAt: string
  plugins: RegistryPlugin[]
}

type Input = {
  Plugin: PluginModel
  PluginVersion: PluginVersionModel
  ServerConfig: ServerConfigModel
}


const getResolver = (input: Input) => {
  const { Plugin, PluginVersion, ServerConfig } = input

  return async (_parent: unknown, _args: unknown, _context: GraphQLContext, _resolveInfo: GraphQLResolveInfo) => {
    try {
      // Get the server config to find registry URLs
      const serverConfigs = await ServerConfig.find({
        selectionSet: `{
          pluginRegistries
        }`
      })

      logger.info('Found server configs:', serverConfigs.length)
      logger.info('Server config pluginRegistries:', serverConfigs[0]?.pluginRegistries)

      if (!serverConfigs.length || !serverConfigs[0].pluginRegistries?.length) {
        throw new Error('No plugin registries configured')
      }

      const registryUrl = serverConfigs[0].pluginRegistries?.[0]
      if (!registryUrl) {
        throw new Error('No plugin registry URL configured')
      }
      
      logger.info(`Fetching plugin registry from: ${registryUrl}`)

      // Fetch registry data
      let registryData: PluginRegistry
      try {
        if (registryUrl.startsWith('gs://')) {
          // For Google Cloud Storage URLs, use authenticated GCS client
          const storage = new Storage()
          const gsPath = registryUrl.replace('gs://', '')
          const [bucketName, ...pathParts] = gsPath.split('/')
          const filePath = pathParts.join('/')
          
          logger.info(`Downloading from GCS bucket: ${bucketName}, file: ${filePath}`)
          
          const bucket = storage.bucket(bucketName)
          const file = bucket.file(filePath)
          
          const [contents] = await file.download()
          registryData = JSON.parse(contents.toString())
        } else {
          // For regular HTTP/HTTPS URLs
          const response = await fetch(registryUrl)
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
          }
          registryData = await response.json()
        }
      } catch (error: unknown) {
        logger.error('Failed to fetch plugin registry:', error)
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(
          `Failed to fetch plugin registry: ${message}`
        )
      }

      logger.info(`Registry updated at: ${registryData.updatedAt}`)
      logger.info(`Found ${registryData.plugins.length} plugins in registry`)

      const updatedPlugins: any[] = []

      // First, find and fix any orphaned plugin versions that exist without Plugin connections
      logger.info('Checking for orphaned plugin versions...')
      
      try {
        const allVersions = await PluginVersion.find({
          selectionSet: `{
            id
            version
            repoUrl
          }`
        })

        logger.info(`Found ${allVersions.length} total plugin versions in database`)

        // Check each version to see if it has a Plugin relationship
        for (const version of allVersions) {
          try {
            // Use a more specific query that won't fail on null relationships
            // We'll try to find plugins that are connected to this version
            const connectedPlugins = await Plugin.find({
              where: {
                Versions: {
                  id: version.id
                }
              },
              selectionSet: `{
                id
                name
              }`
            })

            if (connectedPlugins.length === 0) {
              logger.info(`Found orphaned version: ${version.version} (${version.repoUrl})`)
              
              // Try to match this version to a plugin from the registry
              for (const registryPlugin of registryData.plugins) {
                const matchingVersion = registryPlugin.versions.find(v => v.tarballUrl === version.repoUrl)
                if (matchingVersion) {
                  logger.info(`Attempting to connect orphaned version to plugin: ${registryPlugin.id}`)
                  
                  // Find or create the plugin
                  let plugins = await Plugin.find({
                    where: { name: registryPlugin.id }
                  })

                  let plugin = plugins[0]
                  if (!plugin) {
                    logger.info(`Creating plugin for orphaned version: ${registryPlugin.id}`)
                    const createResult = await Plugin.create({
                      input: [{ name: registryPlugin.id }]
                    })
                    plugin = createResult.plugins[0]
                  }

                  // Connect the orphaned version to the plugin
                  await PluginVersion.update({
                    where: { id: version.id },
                    connect: {
                      Plugin: {
                        where: { node: { id: plugin.id } }
                      }
                    }
                  })
                  
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
  let pluginRecord = (await Plugin.find({
    where: { name: registryPlugin.id },
    selectionSet: `{
      id
      name
    }`
  }))[0]

  let processedAnyVersion = false

  for (const registryVersion of registryPlugin.versions) {
    try {
      const artifacts = await getManifestArtifacts(registryVersion.tarballUrl)
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
        const createResult = await Plugin.create({
          input: [
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
          ]
        })
        pluginRecord = createResult.plugins[0]
      } else {
        await Plugin.update({
          where: { id: pluginRecord.id },
          update: ({
            displayName: pluginUpdatePayload.displayName,
            description: pluginUpdatePayload.description,
            authorName: pluginUpdatePayload.authorName,
            authorUrl: pluginUpdatePayload.authorUrl,
            homepage: pluginUpdatePayload.homepage,
            license: pluginUpdatePayload.license,
            tags: pluginUpdatePayload.tags,
            metadata: pluginUpdatePayload.metadata
          } as unknown as PluginUpdateInput)
        })
      }

      processedAnyVersion = true

      const existingVersions = await PluginVersion.find({
        where: {
          AND: [
            { version: artifacts.version },
            { repoUrl: registryVersion.tarballUrl }
          ]
        },
        selectionSet: `{
          id
          version
        }`
      })

      // Neo4j only accepts primitive types, so stringify nested objects
      const settingsDefaultsRaw = manifest.settingsDefaults ?? manifest.settings ?? null
      const uiSchemaRaw = manifest.ui ?? null
      const settingsDefaults = settingsDefaultsRaw ? JSON.stringify(settingsDefaultsRaw) : null
      const uiSchema = uiSchemaRaw ? JSON.stringify(uiSchemaRaw) : null
      const manifestJson = artifacts.manifest ? JSON.stringify(artifacts.manifest) : null

      if (existingVersions.length === 0) {
        logger.info(
          `Creating new plugin version: ${registryPlugin.id}@${artifacts.version} (registry: ${registryVersion.version})`
        )
        await PluginVersion.create({
          input: [
            ({
              version: artifacts.version,
              repoUrl: registryVersion.tarballUrl,
              tarballGsUri: registryVersion.tarballUrl,
              integritySha256: registryVersion.integritySha256,
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
          ]
        })
      } else {
        const existingVersion = existingVersions[0]
        logger.info(
          `Plugin version already exists: ${registryPlugin.id}@${artifacts.version}, ensuring connection`
        )

        await PluginVersion.update({
          where: { id: existingVersion.id },
          update: ({
            tarballGsUri: registryVersion.tarballUrl,
            integritySha256: registryVersion.integritySha256,
            entryPath: artifacts.entryPath || 'index.js',
            manifest: manifestJson,
            settingsDefaults,
            uiSchema,
            documentationPath: artifacts.readmePath ?? null,
            readmeMarkdown: artifacts.readmeMarkdown ?? null
          } as unknown as PluginVersionUpdateInput),
          connect: {
            Plugin: {
              where: { node: { id: pluginRecord!.id } }
            }
          }
        })
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
          const pluginWithVersions = await Plugin.find({
            where: { id: plugin.id },
            selectionSet: `{
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
                entryPath
                manifest
                settingsDefaults
                uiSchema
                documentationPath
                readmeMarkdown
              }
            }`
          })
          
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
