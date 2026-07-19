import type { GraphQLResolveInfo } from 'graphql'
import type {
  PluginModel,
  ServerConfigModel,
  ServerSecretModel
} from '../../ogm_types.js'
import type { GraphQLContext } from '../../types/context.js'
import { logger } from '../../logger.js'
import {
  buildPluginConfigStatus,
  resolveSecretValidationStatus,
  type PluginConfigScope
} from '../../services/plugin/configStatus.js'

type Input = {
  Plugin: PluginModel
  ServerConfig: ServerConfigModel
  ServerSecret: ServerSecretModel
}

type Args = {
  pluginId: string
  version: string
  scope?: PluginConfigScope
}

const getResolver = ({ Plugin, ServerConfig, ServerSecret }: Input) =>
  async (_parent: unknown, args: Args, _context: GraphQLContext, _info: GraphQLResolveInfo) => {
    const scope = args.scope || 'server'
    try {
      const plugins = await Plugin.find({
        where: { name: args.pluginId },
        selectionSet: `{
          Versions(where: { version: "${args.version}" }) {
            id
            manifest
          }
        }`
      })
      const pluginVersion = plugins[0]?.Versions?.[0]
      if (!pluginVersion) {
        throw new Error(`Plugin ${args.pluginId} version ${args.version} not found`)
      }

      const serverConfigs = await ServerConfig.find({
        selectionSet: `{
          InstalledVersionsConnection(where: { node: { id: "${pluginVersion.id}" } }) {
            edges {
              properties { settingsJson }
            }
          }
        }`
      })
      const edge = serverConfigs[0]?.InstalledVersionsConnection?.edges?.[0]
      if (!edge) {
        throw new Error(`Plugin ${args.pluginId} version ${args.version} is not installed`)
      }

      const secrets = scope === 'server'
        ? await ServerSecret.find({
            where: { pluginId: args.pluginId },
            selectionSet: `{ key isValid lastValidatedAt validationError }`
          })
        : []

      return buildPluginConfigStatus({
        manifest: pluginVersion.manifest,
        settingsJson: edge.properties?.settingsJson,
        secretStatuses: secrets.map(secret => ({
          key: secret.key,
          status: resolveSecretValidationStatus(secret)
        })),
        scope
      })
    } catch (error) {
      logger.error('Error in getPluginConfigStatus resolver:', error)
      throw new Error(`Failed to get plugin config status: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

export default getResolver
