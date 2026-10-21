import type { Driver } from "neo4j-driver";
import { createPluginConfigurationReadRepository, type PluginConfigurationReadRepository } from "../../services/persistence/pluginConfigurationReadRepository.js";
import type { GraphQLResolveInfo } from 'graphql'
import type { GraphQLContext } from '../../types/context.js'
import { logger } from "../../logger.js";

type Input = {
  driver: Driver
  pluginConfigurationReadRepository?: PluginConfigurationReadRepository
}

type Args = {
  pluginId: string
}

const getResolver = (input: Input) => {
  const repository = input.pluginConfigurationReadRepository ?? createPluginConfigurationReadRepository(input.driver)

  return async (_parent: unknown, args: Args, _context: GraphQLContext, _resolveInfo: GraphQLResolveInfo) => {
    const { pluginId } = args

    try {
      // Find all secrets for this plugin
      const secrets = await repository.listPluginSecretStatuses(pluginId)

      // Map to the response format
      return secrets.map(secret => ({
        key: secret.key,
        status: secret.lastValidatedAt 
          ? (secret.isValid ? 'VALID' : 'INVALID')
          : 'SET_UNTESTED',
        lastValidatedAt: secret.lastValidatedAt,
        validationError: secret.validationError
      }))

    } catch (error) {
      logger.error('Error in getServerPluginSecrets resolver:', error)
      throw new Error(`Failed to get server plugin secrets: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

export default getResolver