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
      // Get server config with installed plugins
      const serverConfigs = await ServerConfig.find({
        selectionSet: `{
          InstalledVersions {
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
        }`
      })

      if (!serverConfigs.length || !serverConfigs[0].InstalledVersions) {
        return []
      }

      const serverConfig = serverConfigs[0]
      
      // Get the installation properties for each installed version
      const installedPlugins = []
      
      for (const installedVersion of serverConfig.InstalledVersions) {
        const pluginData = (installedVersion.Plugin || {}) as any
        const versionData = installedVersion as any
        // Query the relationship properties
        const result = await ServerConfig.find({
          where: { serverName: serverConfig.serverName },
          selectionSet: `{
            InstalledVersions(where: { id: "${installedVersion.id}" }) {
              id
              version
              Plugin {
                id
                name
              }
            }
          }`
        })

        // Get the relationship properties separately using a Cypher query
        // This is a workaround since Neo4j GraphQL OGM doesn't easily expose relationship properties
        // In a real implementation, you might use a custom Cypher query here

        installedPlugins.push({
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
          version: installedVersion.version,
          scope: 'SERVER',
          enabled: false, // Default - would need custom query to get actual value
          settingsJson: {},
          manifest: versionData.manifest || null,
          settingsDefaults: versionData.settingsDefaults || null,
          uiSchema: versionData.uiSchema || null,
          documentationPath: versionData.documentationPath || null,
          readmeMarkdown: versionData.readmeMarkdown || null
        })
      }

      return installedPlugins

    } catch (error) {
      console.error('Error in getInstalledPlugins resolver:', error)
      throw new Error(`Failed to get installed plugins: ${(error as any).message}`)
    }
  }
}

export default getResolver