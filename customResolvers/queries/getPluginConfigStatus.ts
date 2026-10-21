import type { GraphQLResolveInfo } from 'graphql'
import type { Driver } from 'neo4j-driver'
import { createPluginStatusRepository, type PluginStatusRepository } from '../../services/persistence/pluginStatusRepository.js'
import type { GraphQLContext } from '../../types/context.js'
import { logger } from '../../logger.js'
import {
  buildPluginConfigStatus,
  resolveSecretValidationStatus,
  type PluginConfigScope
} from '../../services/plugin/configStatus.js'

type Input = { driver: Driver; pluginStatusRepository?: PluginStatusRepository }

type Args = {
  pluginId: string
  version: string
  scope?: PluginConfigScope
}

const getResolver = ({ driver, pluginStatusRepository: repository = createPluginStatusRepository(driver) }: Input) =>
  async (_parent: unknown, args: Args, _context: GraphQLContext, _info: GraphQLResolveInfo) => {
    const scope = args.scope || 'server'
    try {
      const plugins = await repository.findVersion(args.pluginId, args.version)
      const pluginVersion = plugins[0]?.Versions?.[0]
      if (!pluginVersion) {
        throw new Error(`Plugin ${args.pluginId} version ${args.version} not found`)
      }

      const serverConfigs = await repository.findInstallation(pluginVersion.id)
      const edge = serverConfigs[0]?.InstalledVersionsConnection?.edges?.[0]
      if (!edge) {
        throw new Error(`Plugin ${args.pluginId} version ${args.version} is not installed`)
      }

      const secrets = scope === 'server'
        ? await repository.findSecretStatuses(args.pluginId)
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
