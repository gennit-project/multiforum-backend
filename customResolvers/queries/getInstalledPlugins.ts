import type {
  ServerConfigModel
} from '../../ogm_types.js'

type Input = {
  ServerConfig: ServerConfigModel
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

      const installedPlugins = edges.map((edgeData: any) => {
        const edgeProps = edgeData.edge || {}
        const node = edgeData.node || {}
        const pluginData = node.Plugin || {}

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
          version: node.version,
          scope: 'SERVER',
          enabled: edgeProps.enabled ?? false,
          settingsJson: edgeProps.settingsJson || {},
          manifest: node.manifest || null,
          settingsDefaults: node.settingsDefaults || null,
          uiSchema: node.uiSchema || null,
          documentationPath: node.documentationPath || null,
          readmeMarkdown: node.readmeMarkdown || null
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