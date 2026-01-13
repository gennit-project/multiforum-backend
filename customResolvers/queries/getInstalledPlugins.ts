import { Storage } from '@google-cloud/storage'
import type {
  ServerConfigModel
} from '../../ogm_types.js'

type Input = {
  ServerConfig: ServerConfigModel
}

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

/**
 * Compare two semver-style version strings.
 * Returns: negative if a < b, positive if a > b, 0 if equal
 */
function compareVersions(a: string, b: string): number {
  const parseVersion = (v: string) => {
    // Remove 'v' prefix if present
    const clean = v.replace(/^v/, '')
    const parts = clean.split('.').map(p => {
      const num = parseInt(p, 10)
      return isNaN(num) ? 0 : num
    })
    // Pad to 3 parts (major.minor.patch)
    while (parts.length < 3) parts.push(0)
    return parts
  }

  const aParts = parseVersion(a)
  const bParts = parseVersion(b)

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aVal = aParts[i] || 0
    const bVal = bParts[i] || 0
    if (aVal !== bVal) return aVal - bVal
  }
  return 0
}

/**
 * Find the latest version from an array of version strings
 */
function findLatestVersion(versions: string[]): string | null {
  if (!versions.length) return null
  return versions.reduce((latest, current) =>
    compareVersions(current, latest) > 0 ? current : latest
  )
}

const getResolver = (input: Input) => {
  const { ServerConfig } = input

  return async (_parent: any, _args: any, _context: any, _resolveInfo: any) => {
    try {
      // Get server config with installed plugins using Connection pattern
      // This gives us access to relationship properties (enabled, settingsJson)
      const serverConfigs = await ServerConfig.find({
        selectionSet: `{
          serverName
          pluginRegistries
          InstalledVersionsConnection {
            edges {
              edge {
                enabled
                settingsJson
              }
              node {
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
        }`
      })

      if (!serverConfigs.length) {
        return []
      }

      const serverConfig = serverConfigs[0] as any
      const edges = serverConfig.InstalledVersionsConnection?.edges || []

      if (!edges.length) {
        return []
      }

      // Try to fetch registry for version comparison
      let registryData: PluginRegistry | null = null
      const registryUrl = serverConfig.pluginRegistries?.[0]

      if (registryUrl) {
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
            if (response.ok) {
              registryData = await response.json()
            }
          }
        } catch (error) {
          // Registry fetch failed - continue without version comparison
          console.warn('Failed to fetch plugin registry for version comparison:', (error as any).message)
        }
      }

      // Build a map of plugin ID -> available versions from registry
      const registryVersionsMap = new Map<string, string[]>()
      if (registryData?.plugins) {
        for (const plugin of registryData.plugins) {
          const versions = plugin.versions.map(v => v.version)
          registryVersionsMap.set(plugin.id, versions)
        }
      }

      const installedPlugins = edges.map((edgeData: any) => {
        const edgeProps = edgeData.edge || {}
        const node = edgeData.node || {}
        const pluginData = node.Plugin || {}
        const pluginName = pluginData.name
        const installedVersion = node.version

        // Get version info from registry
        const availableVersions = registryVersionsMap.get(pluginName) || []
        const latestVersion = findLatestVersion(availableVersions)
        const hasUpdate = latestVersion
          ? compareVersions(latestVersion, installedVersion) > 0
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
          settingsJson: edgeProps.settingsJson || {},
          manifest: node.manifest || null,
          settingsDefaults: node.settingsDefaults || null,
          uiSchema: node.uiSchema || null,
          documentationPath: node.documentationPath || null,
          readmeMarkdown: node.readmeMarkdown || null,
          hasUpdate,
          latestVersion,
          availableVersions: availableVersions.sort((a, b) => compareVersions(b, a)) // sorted newest first
        }
      })

      return installedPlugins

    } catch (error) {
      console.error('Error in getInstalledPlugins resolver:', error)
      throw new Error(`Failed to get installed plugins: ${(error as any).message}`)
    }
  }
}

export default getResolver