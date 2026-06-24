import type { GraphQLResolveInfo } from 'graphql'
import type { GraphQLContext } from '../../types/context.js'
import type { PluginRunModel, PluginRunWhere, PluginRunOptions } from '../../ogm_types.js'

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
      } as unknown as PluginRunWhere),
      options: ({
        sort: [
          { pipelineId: 'DESC' },
          { executionOrder: 'ASC' },
          { createdAt: 'DESC' }
        ]
      } as unknown as PluginRunOptions),
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
