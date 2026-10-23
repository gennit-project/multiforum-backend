import { GraphQLResolveInfo } from 'graphql'
import type { GraphQLContext } from '../types/context.js'
import { triggerPluginRunsForComment } from '../services/pluginRunner.js'
import { logger } from "../logger.js";
import { PLUGIN_EVENTS, type PluginEvent } from "../services/plugin/constants.js";

type CommentMutationResult = {
  comments?: Array<{ id?: string }>
}

type UpdateCommentsArgs = {
  update?: {
    text?: unknown
    [key: string]: unknown
  }
  [key: string]: unknown
}

type TriggerCommentPlugins = typeof triggerPluginRunsForComment

const dispatchCommentEvents = async ({
  result,
  context,
  event,
  triggerCommentPlugins,
}: {
  result: CommentMutationResult | undefined
  context: GraphQLContext
  event: PluginEvent
  triggerCommentPlugins: TriggerCommentPlugins
}) => {
  const driver = context?.driver
  if (!driver) return

  for (const comment of result?.comments || []) {
    const commentId = comment?.id
    if (!commentId) continue

    await triggerCommentPlugins(
      {
        commentId,
        event,
        driver,
      },
      { execution: { deferExecution: true } }
    )
  }
}

export const createCommentPluginPipelineMiddleware = (
  triggerCommentPlugins: TriggerCommentPlugins = triggerPluginRunsForComment
) => ({
  Mutation: {
    createComments: async (
      resolve: (parent: unknown, args: unknown, context: GraphQLContext, info: GraphQLResolveInfo) => Promise<CommentMutationResult | undefined>,
      parent: unknown,
      args: unknown,
      context: GraphQLContext,
      info: GraphQLResolveInfo
    ) => {
      const result = await resolve(parent, args, context, info)

      try {
        await dispatchCommentEvents({
          result,
          context,
          event: PLUGIN_EVENTS.COMMENT_CREATED,
          triggerCommentPlugins,
        })
      } catch (error) {
        logger.warn('Comment plugin pipeline failed:', error instanceof Error ? error.message : error)
      }

      return result
    },
    updateComments: async (
      resolve: (parent: unknown, args: UpdateCommentsArgs, context: GraphQLContext, info: GraphQLResolveInfo) => Promise<CommentMutationResult | undefined>,
      parent: unknown,
      args: UpdateCommentsArgs,
      context: GraphQLContext,
      info: GraphQLResolveInfo
    ) => {
      const result = await resolve(parent, args, context, info)

      if (args.update?.text === undefined) {
        return result
      }

      try {
        await dispatchCommentEvents({
          result,
          context,
          event: PLUGIN_EVENTS.COMMENT_EDITED,
          triggerCommentPlugins,
        })
      } catch (error) {
        logger.warn('Comment plugin pipeline failed:', error instanceof Error ? error.message : error)
      }

      return result
    }
  }
})

const commentPluginPipelineMiddleware = createCommentPluginPipelineMiddleware()

export default commentPluginPipelineMiddleware
