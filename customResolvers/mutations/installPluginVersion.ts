import crypto from 'crypto'
import { Storage } from '@google-cloud/storage'
import type {
  PluginModel,
  PluginVersionModel,
  ServerConfigModel
} from '../../ogm_types.js'
import { parseManifestFromTarball } from './shared/pluginManifest.js'

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

type Args = {
  pluginId: string
  version: string
}

const getResolver = (input: Input) => {
  const { Plugin, PluginVersion, ServerConfig } = input

  return async (_parent: any, args: Args, _context: any, _resolveInfo: any) => {
    const { pluginId, version } = args

    try {
      // 1. Get server config to find registry URLs
      const serverConfigs = await ServerConfig.find({
        selectionSet: `{
          serverName
          pluginRegistries
        }`
      })

      if (!serverConfigs.length || !serverConfigs[0].pluginRegistries?.length) {
        throw new Error('No plugin registries configured')
      }

      const registryUrl = serverConfigs[0].pluginRegistries?.[0]
      if (!registryUrl) {
        throw new Error('No plugin registry URL configured')
      }
      console.log('Using plugin registry URL:', registryUrl)

      // 2. Fetch and find plugin version in registry
      let registryData: PluginRegistry
      try {
        if (registryUrl.startsWith('gs://')) {
          const storage = new Storage()
          const gsPath = registryUrl.replace('gs://', '')
          const [bucketName, ...pathParts] = gsPath.split('/')
          const filePath = pathParts.join('/')
          
          const bucket = storage.bucket(bucketName)
          const file = bucket.file(filePath)
          
          const [contents] = await file.download()
          registryData = JSON.parse(contents.toString())
        } else {
          const response = await fetch(registryUrl)
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
          }
          registryData = await response.json()
        }
      } catch (error) {
        throw new Error(`Failed to fetch plugin registry: ${(error as any).message}`)
      }

      // First, resolve the plugin node using either the Neo4j ID or the plugin slug
      const pluginCandidates = await Plugin.find({
        where: {
          OR: [
            { id: pluginId },
            { name: pluginId }
          ]
        },
        selectionSet: `{
          id
          name
          displayName
        }`
      })

      let pluginRecord = pluginCandidates[0] || null
      let pluginSlug = pluginRecord?.name || pluginId

      // Check if this version already exists in the database
      const existingDbVersions = await PluginVersion.find({
        where: {
          AND: [
            { version: version },
            { Plugin: { name: pluginSlug } }
          ]
        },
        selectionSet: `{
          id
          version
          repoUrl
          tarballGsUri
          integritySha256
          entryPath
          Plugin {
            id
            name
          }
        }`
      })

      let registryVersion: any

      // Always get the version data from the registry for integrity verification
      const registryPlugin = registryData.plugins.find(p => p.id === pluginSlug)
      if (!registryPlugin) {
        throw new Error(`Plugin ${pluginSlug} not found in registry`)
      }

      const registryVersionData = registryPlugin.versions.find(v => v.version === version)
      if (!registryVersionData) {
        throw new Error(`Plugin ${pluginSlug} version ${version} not found in registry`)
      }

      if (existingDbVersions.length > 0) {
        const dbVersion = existingDbVersions[0]
        console.log(`Found existing version in database: ${pluginSlug}@${version}`)
        // Use database URL but always use registry hash for verification
        registryVersion = {
          version: dbVersion.version,
          tarballUrl: dbVersion.repoUrl || registryVersionData.tarballUrl,
          integritySha256: registryVersionData.integritySha256 // Always use registry hash
        }
      } else {
        registryVersion = registryVersionData
      }

      console.log('Using version data:', JSON.stringify(registryVersion, null, 2))

      // 3. Download and verify tarball integrity
      console.log(`Downloading tarball from: ${registryVersion.tarballUrl}`)
      
      let tarballBytes: Buffer
      if (registryVersion.tarballUrl.startsWith('gs://')) {
        const storage = new Storage()
        const gsPath = registryVersion.tarballUrl.replace('gs://', '')
        const [bucketName, ...pathParts] = gsPath.split('/')
        const filePath = pathParts.join('/')
        
        const bucket = storage.bucket(bucketName)
        const file = bucket.file(filePath)
        
        const [contents] = await file.download()
        tarballBytes = contents
      } else {
        const response = await fetch(registryVersion.tarballUrl)
        if (!response.ok) {
          throw new Error(`Failed to download tarball: HTTP ${response.status}`)
        }
        tarballBytes = Buffer.from(await response.arrayBuffer())
      }

      // 4. Verify integrity
      const actualSha256 = crypto.createHash('sha256').update(tarballBytes).digest('hex')
      console.log('Tarball integrity check:')
      console.log('  Expected SHA-256:', registryVersion.integritySha256)
      console.log('  Actual SHA-256:  ', actualSha256)
      console.log('  Tarball size:    ', tarballBytes.length, 'bytes')
      if (actualSha256 !== registryVersion.integritySha256) {
        throw new Error(`Tarball integrity verification failed: SHA-256 mismatch. Expected: ${registryVersion.integritySha256}, Got: ${actualSha256}`)
      }

      const artifacts = await parseManifestFromTarball(tarballBytes)

      if (artifacts.version !== version) {
        throw new Error(`Manifest version ${artifacts.version} doesn't match requested version ${version}`)
      }

      if (artifacts.id !== pluginSlug) {
        throw new Error(`Manifest ID ${artifacts.id} doesn't match requested plugin ${pluginSlug}`)
      }

      const manifest = artifacts.manifest || {}
      const metadata = manifest.metadata || {}
      const author = metadata.author || {}
      const tags = Array.isArray(metadata.tags) ? metadata.tags.filter((tag: any) => typeof tag === 'string') : []

      const pluginUpdatePayload = {
        displayName: manifest.name || pluginSlug,
        description: manifest.description || null,
        authorName: author.name || null,
        authorUrl: author.url || null,
        homepage: metadata.homepage || manifest.homepage || null,
        license: metadata.license || manifest.license || null,
        tags,
        metadata: metadata && Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null
      }

      if (!pluginRecord) {
        console.log(`Creating new plugin record for ${artifacts.id}`)
        const createResult = await Plugin.create({
          input: [
            ({
              name: artifacts.id,
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

      pluginSlug = artifacts.id

      let pluginVersion = existingDbVersions[0] || null
      // Neo4j only accepts primitive types, so stringify nested objects
      const settingsDefaultsRaw = manifest.settingsDefaults ?? manifest.settings ?? null
      const uiSchemaRaw = manifest.ui ?? null
      const settingsDefaults = settingsDefaultsRaw ? JSON.stringify(settingsDefaultsRaw) : null
      const uiSchema = uiSchemaRaw ? JSON.stringify(uiSchemaRaw) : null
      const manifestJson = artifacts.manifest ? JSON.stringify(artifacts.manifest) : null
      const documentationPath = artifacts.readmePath ?? manifest.documentation?.readmePath ?? null
      const readmeMarkdown = artifacts.readmeMarkdown ?? null

      if (!pluginVersion) {
        console.log(`Creating new plugin version: ${pluginSlug}@${version}`)
        const createResult = await PluginVersion.create({
          input: [
            ({
              version,
              repoUrl: String(registryVersion.tarballUrl),
              tarballGsUri: String(registryVersion.tarballUrl),
              integritySha256: String(registryVersion.integritySha256),
              entryPath: artifacts.entryPath || 'index.js',
              manifest: manifestJson,
              settingsDefaults,
              uiSchema,
              documentationPath,
              readmeMarkdown,
              Plugin: {
                connect: {
                  where: { node: { id: pluginRecord!.id } }
                }
              }
            } as any)
          ]
        })
        pluginVersion = createResult.pluginVersions[0]
      } else {
        await PluginVersion.update({
          where: { id: pluginVersion.id },
          update: ({
            repoUrl: String(registryVersion.tarballUrl),
            tarballGsUri: String(registryVersion.tarballUrl),
            integritySha256: String(registryVersion.integritySha256),
            entryPath: artifacts.entryPath || pluginVersion.entryPath || 'index.js',
            manifest: manifestJson,
            settingsDefaults,
            uiSchema,
            documentationPath,
            readmeMarkdown
          } as any),
          connect: {
            Plugin: {
              where: { node: { id: pluginRecord!.id } }
            }
          }
        })
      }

      const serverConfig = serverConfigs[0]

      const installedVersions = await ServerConfig.find({
        where: { serverName: serverConfig.serverName },
        selectionSet: `{
          InstalledVersions(where: { id: "${pluginVersion.id}" }) {
            id
            version
            Plugin {
              id
              name
            }
          }
        }`
      })

      const isAlreadyInstalled = installedVersions[0]?.InstalledVersions?.length > 0

      if (!isAlreadyInstalled) {
        console.log('Installing plugin version, serverName:', serverConfig.serverName, 'pluginVersion.id:', pluginVersion.id)

        await ServerConfig.update({
          where: { serverName: String(serverConfig.serverName) },
          connect: {
            InstalledVersions: [{
              where: { node: { id: String(pluginVersion.id) } },
              edge: {
                enabled: false,
                settingsJson: null
              }
            }]
          }
        })
      }

      return {
        plugin: {
          id: String(pluginRecord!.id),
          name: String(pluginRecord!.name),
          displayName: pluginUpdatePayload.displayName,
          description: pluginUpdatePayload.description,
          authorName: pluginUpdatePayload.authorName,
          authorUrl: pluginUpdatePayload.authorUrl,
          homepage: pluginUpdatePayload.homepage,
          license: pluginUpdatePayload.license,
          tags: pluginUpdatePayload.tags,
          metadata: pluginUpdatePayload.metadata
        },
        version: String(version),
        scope: 'SERVER',
        enabled: false,
        settingsJson: null
      }

    } catch (error) {
      console.error('Error in installPluginVersion resolver:', error)
      throw new Error(`Failed to install plugin: ${(error as any).message}`)
    }
  }
}

export default getResolver