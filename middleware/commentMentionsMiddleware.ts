import { GraphQLResolveInfo } from 'graphql'
import { parseBotMentions } from '../utils/botMentionParser.js'

const isDiscussionCommentInput = (input: any): boolean => {
  if (!input || typeof input !== 'object') return false
  if (!input.DiscussionChannel) return false
  if (input.isFeedbackComment) return false
  if (input.Event || input.Issue) return false
  if (input.GivesFeedbackOnComment || input.GivesFeedbackOnDiscussion || input.GivesFeedbackOnEvent) return false
  return true
}

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

          if (!isDiscussionCommentInput(input)) {
            return {
              ...input,
              botMentions: null
            }
          }

          const mentions = parseBotMentions(input?.text || '')
          return {
            ...input,
            botMentions: mentions.length ? JSON.stringify(mentions) : null
          }
        })
      }

      return resolve(parent, args, context, info)
    }
  }
}

export default commentMentionsMiddleware
