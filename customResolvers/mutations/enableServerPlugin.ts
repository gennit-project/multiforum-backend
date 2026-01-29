import type {
  PluginModel,
  PluginVersionModel,
  ServerConfigModel,
  ServerSecretModel
} from '../../ogm_types.js'

type Input = {
  Plugin: PluginModel
  PluginVersion: PluginVersionModel
  ServerConfig: ServerConfigModel
  ServerSecret: ServerSecretModel
}

type Args = {
  pluginId: string
  version: string
  enabled: boolean
  settingsJson?: any
}

const getResolver = (input: Input) => {
  const { Plugin, PluginVersion, ServerConfig, ServerSecret } = input

  return async (_parent: any, args: Args, _context: any, _resolveInfo: any) => {
    const { pluginId, version, enabled, settingsJson = {} } = args

    try {
      // 1. Find the plugin and version
      const plugins = await Plugin.find({
        where: { name: pluginId },
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
          Versions(where: { version: "${version}" }) {
            id
            version
            manifest
            settingsDefaults
            uiSchema
            documentationPath
            readmeMarkdown
          }
        }`
      })

      if (!plugins.length) {
        throw new Error(`Plugin ${pluginId} not found`)
      }

      const plugin = plugins[0]
      const pluginVersion = plugin.Versions?.[0]
      
      if (!pluginVersion) {
        throw new Error(`Plugin ${pluginId} version ${version} not found`)
      }

      const pluginData = plugin as any
      const pluginVersionData = pluginVersion as any
      const manifest = pluginVersionData.manifest || {}
      const manifestSecrets = Array.isArray(manifest.secrets) ? manifest.secrets : []
      const requiredServerSecrets = manifestSecrets.filter((secret: any) => secret && secret.scope === 'server' && secret.required !== false)

      // 2. Get server config
      const serverConfigs = await ServerConfig.find({
        selectionSet: `{
          serverName
          InstalledVersions(where: { id: "${pluginVersion.id}" }) {
            id
            version
          }
        }`
      })

      if (!serverConfigs.length) {
        throw new Error('Server configuration not found')
      }

      const serverConfig = serverConfigs[0]
      const isInstalled = serverConfig.InstalledVersions?.length > 0

      if (!isInstalled) {
        throw new Error(`Plugin ${pluginId} version ${version} is not installed. Please install it first.`)
      }

      // 3. If enabling, validate required secrets from the manifest
      if (enabled) {
        const secrets = await ServerSecret.find({
          where: { pluginId },
          selectionSet: `{
            key
            isValid
            validationError
            lastValidatedAt
          }`
        })

        const secretMap = new Map(secrets.map(secret => [secret.key, secret]))
        const requiredKeys = requiredServerSecrets.map((secret: any) => secret.key as string)

        const missingKeys = requiredKeys.filter((key: string) => !secretMap.has(key))
        if (missingKeys.length > 0) {
          throw new Error(`Missing required secrets: ${missingKeys.join(', ')}`)
        }

        const invalidKeys = requiredKeys.filter((key: string) => {
          const record: any = secretMap.get(key)
          if (!record) return false
          if (record.lastValidatedAt && record.isValid === false) {
            return true
          }
          if (record.validationError) {
            return true
          }
          return false
        })

        if (invalidKeys.length > 0) {
          throw new Error(`Cannot enable plugin: invalid or failing validation for secrets: ${invalidKeys.join(', ')}`)
        }
      }

      // 4. Update the installation relationship
      await ServerConfig.update({
        where: { serverName: serverConfig.serverName },
        update: {
          InstalledVersions: [{
            where: { node: { id: pluginVersion.id } },
            update: {
              edge: {
                enabled,
                settingsJson
              }
            }
          }]
        }
      })



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
        version,
        scope: 'SERVER',
        enabled,
        settingsJson,
        manifest: manifest || null,
        settingsDefaults: pluginVersionData.settingsDefaults || null,
        uiSchema: pluginVersionData.uiSchema || null,
        documentationPath: pluginVersionData.documentationPath || null,
        readmeMarkdown: pluginVersionData.readmeMarkdown || null
      }

    } catch (error) {
      console.error('Error in enableServerPlugin resolver:', error)
      throw new Error(`Failed to ${enabled ? 'enable' : 'disable'} plugin: ${(error as any).message}`)
    }
  }
}

export default getResolver
