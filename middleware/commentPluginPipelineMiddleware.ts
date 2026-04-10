import { GraphQLResolveInfo } from 'graphql'
import { triggerPluginRunsForComment } from '../services/pluginRunner.js'

const commentPluginPipelineMiddleware = {
  Mutation: {
    createComments: async (
      resolve: (parent: unknown, args: any, context: any, info: GraphQLResolveInfo) => Promise<any>,
      parent: unknown,
      args: any,
      context: any,
      info: GraphQLResolveInfo
    ) => {
      const result = await resolve(parent, args, context, info)

      try {
        const createdComments = result?.comments || []
        const Channel = context?.ogm?.model('Channel')
        const Comment = context?.ogm?.model('Comment')
        const Discussion = context?.ogm?.model('Discussion')
        const Event = context?.ogm?.model('Event')
        const Issue = context?.ogm?.model('Issue')
        const PluginRun = context?.ogm?.model('PluginRun')
        const ServerConfig = context?.ogm?.model('ServerConfig')
        const ServerSecret = context?.ogm?.model('ServerSecret')
        const User = context?.ogm?.model('User')
        const driver = context?.driver

        if (!Channel || !Comment || !PluginRun || !ServerConfig || !ServerSecret || !User) {
          return result
        }

        for (const comment of createdComments) {
          const commentId = comment?.id
          if (!commentId) continue

          await triggerPluginRunsForComment({
            commentId,
            event: 'comment.created',
            models: {
              Channel,
              Comment,
              Discussion,
              Event,
              Issue,
              PluginRun,
              ServerConfig,
              ServerSecret,
              User
            },
            driver
          })
        }
      } catch (error) {
        console.warn('Comment plugin pipeline failed:', (error as any)?.message || error)
      }

      return result
    }
  }
}

export default commentPluginPipelineMiddleware
