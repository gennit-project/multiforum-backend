import type { GraphQLResolveInfo } from 'graphql'
import type {
  PluginModel,
  PluginVersionModel,
  ServerConfigModel,
  ServerSecretModel
} from '../../ogm_types.js'
import type { GraphQLContext } from '../../types/context.js'
import { logger } from "../../logger.js";

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
  settingsJson?: Record<string, unknown>
}

const getResolver = (input: Input) => {
  const { Plugin, PluginVersion, ServerConfig, ServerSecret } = input

  return async (_parent: unknown, args: Args, _context: GraphQLContext, _resolveInfo: GraphQLResolveInfo) => {
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

      // `manifest` is a JSON scalar, so it's still read as a dynamic record.
      const manifest = (pluginVersion.manifest as Record<string, unknown>) || {}
      const manifestSecrets = Array.isArray(manifest.secrets) ? manifest.secrets : []
      const requiredServerSecrets = manifestSecrets.filter((secret: { scope?: string; required?: boolean }) => secret && secret.scope === 'server' && secret.required !== false)

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
        const requiredKeys = requiredServerSecrets.map((secret: { key: string }) => secret.key as string)

        const missingKeys = requiredKeys.filter((key: string) => !secretMap.has(key))
        if (missingKeys.length > 0) {
          throw new Error(`Missing required secrets: ${missingKeys.join(', ')}`)
        }

        const invalidKeys = requiredKeys.filter((key: string) => {
          const record = secretMap.get(key) as { isValid?: boolean | null; validationError?: string | null; lastValidatedAt?: string | null } | undefined
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
      const settingsJsonValue =
        settingsJson && Object.keys(settingsJson).length > 0
          ? JSON.stringify(settingsJson)
          : null

      await ServerConfig.update({
        where: { serverName: serverConfig.serverName },
        update: {
          InstalledVersions: [{
            where: { node: { id: pluginVersion.id } },
            update: {
              edge: {
                enabled,
                settingsJson: settingsJsonValue
              }
            }
          }]
        }
      })



      return {
        plugin: {
          id: plugin.id,
          name: plugin.name,
          displayName: plugin.displayName,
          description: plugin.description,
          authorName: plugin.authorName,
          authorUrl: plugin.authorUrl,
          homepage: plugin.homepage,
          license: plugin.license,
          tags: plugin.tags || [],
          metadata: plugin.metadata || null
        },
        version,
        scope: 'SERVER',
        enabled,
        settingsJson,
        manifest: manifest || null,
        settingsDefaults: pluginVersion.settingsDefaults || null,
        uiSchema: pluginVersion.uiSchema || null,
        documentationPath: pluginVersion.documentationPath || null,
        readmeMarkdown: pluginVersion.readmeMarkdown || null
      }

    } catch (error: unknown) {
      logger.error('Error in enableServerPlugin resolver:', error)
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to ${enabled ? 'enable' : 'disable'} plugin: ${message}`)
    }
  }
}

export default getResolver
