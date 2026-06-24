import type { GraphQLResolveInfo } from 'graphql'
import type { GraphQLContext } from '../../types/context.js'
import type { PluginRunModel } from '../../ogm_types.js'

type Input = {
  PluginRun: PluginRunModel
}

type Args = {
  targetId: string
  targetType: string
}

const getResolver = (input: Input) => {
  const { PluginRun } = input

  return async (_parent: unknown, args: Args, _context: GraphQLContext, _info: GraphQLResolveInfo) => {
    const { targetId, targetType } = args

    const runs = await PluginRun.find({
      where: ({
        AND: [
          { targetId },
          { targetType }
        ]
      } as any),
      options: ({
        sort: [
          { pipelineId: 'DESC' },
          { executionOrder: 'ASC' },
          { createdAt: 'DESC' }
        ]
      } as any),
      selectionSet: `{
        id
        pluginId
        pluginName
        version
        scope
        channelId
        eventType
        status
        message
        durationMs
        targetId
        targetType
        payload
        pipelineId
        executionOrder
        skippedReason
        createdAt
        updatedAt
      }`
    })

    return runs
  }
}

export default getResolver
