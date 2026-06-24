import type {
  ServerSecretModel
} from '../../ogm_types.js'
import type { GraphQLResolveInfo } from 'graphql'
import type { GraphQLContext } from '../../types/context.js'
import { encryptSecret } from '../../services/plugin/encryption.js'

type Input = {
  ServerSecret: ServerSecretModel
}

type Args = {
  pluginId: string
  key: string
  value: string
}

const getResolver = (input: Input) => {
  const { ServerSecret } = input

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
      const existingSecrets = await ServerSecret.find({
        where: {
          AND: [
            { pluginId },
            { key }
          ]
        }
      })

      if (existingSecrets.length > 0) {
        // Update existing secret
        await ServerSecret.update({
          where: { id: existingSecrets[0].id },
          update: {
            ciphertext,
            isValid: false, // Reset validation status when value changes
            lastValidatedAt: null,
            validationError: null
          }
        })
      } else {
        // Create new secret
        await ServerSecret.create({
          input: [
            {
              pluginId,
              key,
              ciphertext,
              isValid: false,
              updatedAt: new Date().toISOString()
            }
          ]
        })
      }

      return true
    } catch (error: unknown) {
      console.error('Error in setServerPluginSecret resolver:', error)
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to set server plugin secret: ${message}`)
    }
  }
}

export default getResolver