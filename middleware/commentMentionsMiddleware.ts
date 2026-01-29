import { GraphQLResolveInfo } from 'graphql'
import { parseBotMentions } from '../utils/botMentionParser.js'

const commentMentionsMiddleware = {
  Mutation: {
    createComments: async (
      resolve: (parent: unknown, args: any, context: any, info: GraphQLResolveInfo) => Promise<any>,
      parent: unknown,
      args: any,
      context: any,
      info: GraphQLResolveInfo
    ) => {
      if (Array.isArray(args?.input)) {
        args.input = args.input.map((input: any) => {
          if (input?.botMentions !== undefined) {
            return input
          }

          const mentions = parseBotMentions(input?.text || '')
          return {
            ...input,
            botMentions: mentions
          }
        })
      }

      return resolve(parent, args, context, info)
    }
  }
}

export default commentMentionsMiddleware
