import { GraphQLResolveInfo } from 'graphql'
import type { GraphQLContext } from '../types/context.js'
import { triggerPluginRunsForComment } from '../services/pluginRunner.js'
import { logger } from "../logger.js";

const commentPluginPipelineMiddleware = {
  Mutation: {
    createComments: async (
      resolve: (parent: unknown, args: unknown, context: GraphQLContext, info: GraphQLResolveInfo) => Promise<{ comments?: { id?: string }[] } | undefined>,
      parent: unknown,
      args: unknown,
      context: GraphQLContext,
      info: GraphQLResolveInfo
    ) => {
      const result = await resolve(parent, args, context, info)

      try {
        const createdComments = result?.comments || []
        const driver = context?.driver

        if (!driver) {
          return result
        }

        for (const comment of createdComments) {
          const commentId = comment?.id
          if (!commentId) continue

          await triggerPluginRunsForComment({
            commentId,
            event: 'comment.created',
            driver
          })
        }
      } catch (error) {
        logger.warn('Comment plugin pipeline failed:', error instanceof Error ? error.message : error)
      }

      return result
    }
  }
}

export default commentPluginPipelineMiddleware
