import { GraphQLResolveInfo } from 'graphql'
import type { GraphQLContext } from '../types/context.js'
import { parseBotMentions } from '../utils/botMentionParser.js'

interface CreateCommentsArgs {
  input?: Record<string, unknown>[]
  [key: string]: unknown
}

const isDiscussionCommentInput = (input: Record<string, unknown> | null | undefined): boolean => {
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
      resolve: (parent: unknown, args: CreateCommentsArgs, context: GraphQLContext, info: GraphQLResolveInfo) => Promise<unknown>,
      parent: unknown,
      args: CreateCommentsArgs,
      context: GraphQLContext,
      info: GraphQLResolveInfo
    ) => {
      if (Array.isArray(args?.input)) {
        args.input = args.input.map((input: Record<string, unknown>) => {
          if (input?.botMentions !== undefined) {
            return input
          }

          if (!isDiscussionCommentInput(input)) {
            return {
              ...input,
              botMentions: null
            }
          }

          const mentions = parseBotMentions((input?.text as string | null | undefined) || '')
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
