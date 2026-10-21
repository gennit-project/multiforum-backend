import type { Driver } from "neo4j-driver"
import { createServerSecretRepository, type ServerSecretRepository } from "../../services/persistence/serverSecretRepository.js"
import type { GraphQLResolveInfo } from 'graphql'
import type { GraphQLContext } from '../../types/context.js'
import { encryptSecret } from '../../services/plugin/encryption.js'
import { logger } from "../../logger.js";

type Input = {
  driver: Driver
  serverSecretRepository?: ServerSecretRepository
}

type Args = {
  pluginId: string
  key: string
  value: string
}

const getResolver = (input: Input) => {
  const { serverSecretRepository = createServerSecretRepository(input.driver) } = input

  return async (
    _parent: unknown,
    args: Args,
    _context: GraphQLContext,
    _resolveInfo: GraphQLResolveInfo
  ) => {
    const { pluginId, key, value } = args

    try {
      // Encrypt the secret value
      const ciphertext = encryptSecret(value)

      // Find existing secret or create new one
      const existingSecrets = await serverSecretRepository.findForReplacement(pluginId, key)
      if (existingSecrets.length > 0) {
        await serverSecretRepository.replaceCiphertext(existingSecrets[0].id, ciphertext)
      } else {
        await serverSecretRepository.createEncryptedSecret(pluginId, key, ciphertext, new Date().toISOString())
      }

      return true
    } catch (error: unknown) {
      logger.error('Error in setServerPluginSecret resolver:', error)
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to set server plugin secret: ${message}`)
    }
  }
}

export default getResolver