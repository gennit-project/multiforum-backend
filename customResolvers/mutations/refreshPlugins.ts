import type {
  PluginModel,
  PluginVersionModel,
  ServerConfigModel
} from '../../ogm_types.js'
import { Storage } from '@google-cloud/storage'
import { getManifestArtifacts } from './shared/pluginManifest.js'

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

  return async (_parent: any, _args: any, _context: any, _resolveInfo: any) => {
    try {
      // Get the server config to find registry URLs
      const serverConfigs = await ServerConfig.find({
        selectionSet: `{
          pluginRegistries
        }`
      })

      console.log('Found server configs:', serverConfigs.length)
      console.log('Server config pluginRegistries:', serverConfigs[0]?.pluginRegistries)

      if (!serverConfigs.length || !serverConfigs[0].pluginRegistries?.length) {
        throw new Error('No plugin registries configured')
      }

      const registryUrl = serverConfigs[0].pluginRegistries?.[0]
      if (!registryUrl) {
        throw new Error('No plugin registry URL configured')
      }
      
      console.log(`Fetching plugin registry from: ${registryUrl}`)

      // Fetch registry data
      let registryData: PluginRegistry
      try {
        if (registryUrl.startsWith('gs://')) {
          // For Google Cloud Storage URLs, use authenticated GCS client
          const storage = new Storage()
          const gsPath = registryUrl.replace('gs://', '')
          const [bucketName, ...pathParts] = gsPath.split('/')
          const filePath = pathParts.join('/')
          
          console.log(`Downloading from GCS bucket: ${bucketName}, file: ${filePath}`)
          
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
      } catch (error) {
        console.error('Failed to fetch plugin registry:', error)
        throw new Error(
          `Failed to fetch plugin registry: ${(error as any).message}`
        )
      }

      console.log(`Registry updated at: ${registryData.updatedAt}`)
      console.log(`Found ${registryData.plugins.length} plugins in registry`)

      const updatedPlugins: any[] = []

      // First, find and fix any orphaned plugin versions that exist without Plugin connections
      console.log('Checking for orphaned plugin versions...')
      
      try {
        const allVersions = await PluginVersion.find({
          selectionSet: `{
            id
            version
            repoUrl
          }`
        })

        console.log(`Found ${allVersions.length} total plugin versions in database`)

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
              console.log(`Found orphaned version: ${version.version} (${version.repoUrl})`)
              
              // Try to match this version to a plugin from the registry
              for (const registryPlugin of registryData.plugins) {
                const matchingVersion = registryPlugin.versions.find(v => v.tarballUrl === version.repoUrl)
                if (matchingVersion) {
                  console.log(`Attempting to connect orphaned version to plugin: ${registryPlugin.id}`)
                  
                  // Find or create the plugin
                  let plugins = await Plugin.find({
                    where: { name: registryPlugin.id }
                  })

                  let plugin = plugins[0]
                  if (!plugin) {
                    console.log(`Creating plugin for orphaned version: ${registryPlugin.id}`)
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
                  
                  console.log(`Successfully connected orphaned version ${version.version} to plugin ${registryPlugin.id}`)
                  break
                }
              }
            }
          } catch (versionError) {
            console.warn(`Skipping version ${version.id} due to error:`, (versionError as any).message)
          }
        }
      } catch (orphanError) {
        console.warn('Error while checking orphaned versions:', (orphanError as any).message)
        // Continue with normal processing even if orphan check fails
      }

      console.log('Finished checking orphaned versions, proceeding with registry processing...')


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
      console.log(`Registry version: ${registryVersion.version}, Manifest version: ${artifacts.version}`)

      if (artifacts.id !== registryPlugin.id) {
        console.warn(`Plugin ID mismatch: registry=${registryPlugin.id}, manifest=${artifacts.id}. Skipping.`)
        continue
      }

      const manifest = artifacts.manifest || {}
      const metadata = manifest.metadata || {}
      const author = metadata.author || {}
      const tags = Array.isArray(metadata.tags) ? metadata.tags : []

      const pluginUpdatePayload = {
        displayName: manifest.name || registryPlugin.id,
        description: manifest.description || null,
        authorName: author.name || null,
        authorUrl: author.url || null,
        homepage: metadata.homepage || manifest.homepage || null,
        license: metadata.license || manifest.license || null,
        tags,
        metadata
      }

      if (!pluginRecord) {
        console.log(`Creating new plugin: ${registryPlugin.id}`)
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
            } as any)
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
          } as any)
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

      const settingsDefaults = manifest.settingsDefaults ?? manifest.settings ?? null
      const uiSchema = manifest.ui ?? null

      if (existingVersions.length === 0) {
        console.log(
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
              manifest: artifacts.manifest,
              settingsDefaults,
              uiSchema,
              documentationPath: artifacts.readmePath ?? null,
              readmeMarkdown: artifacts.readmeMarkdown ?? null,
              Plugin: {
                connect: {
                  where: { node: { id: pluginRecord!.id } }
                }
              }
            } as any)
          ]
        })
      } else {
        const existingVersion = existingVersions[0]
        console.log(
          `Plugin version already exists: ${registryPlugin.id}@${artifacts.version}, ensuring connection`
        )

        await PluginVersion.update({
          where: { id: existingVersion.id },
          update: ({
            tarballGsUri: registryVersion.tarballUrl,
            integritySha256: registryVersion.integritySha256,
            entryPath: artifacts.entryPath || 'index.js',
            manifest: artifacts.manifest,
            settingsDefaults,
            uiSchema,
            documentationPath: artifacts.readmePath ?? null,
            readmeMarkdown: artifacts.readmeMarkdown ?? null
          } as any),
          connect: {
            Plugin: {
              where: { node: { id: pluginRecord!.id } }
            }
          }
        })
      }
    } catch (error) {
      console.warn(`Failed to process version ${registryVersion.version} for plugin ${registryPlugin.id}:`, (error as any).message)
      continue
    }
  }

  if (pluginRecord && processedAnyVersion) {
    updatedPlugins.push(pluginRecord)
  }
}

      console.log(`Successfully refreshed ${updatedPlugins.length} plugins`)
      
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
        } catch (error) {
          console.warn(`Could not load versions for plugin ${plugin.id}:`, (error as any).message)
          // Still include the plugin but with empty versions array
          pluginsWithVersions.push({
            ...plugin,
            Versions: []
          })
        }
      }
      
      return pluginsWithVersions
    } catch (error) {
      console.error('Error in refreshPlugins resolver:', error)
      throw new Error(`Failed to refresh plugins: ${(error as any).message}`)
    }
  }
}

export default getResolver
