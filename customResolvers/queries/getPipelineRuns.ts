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

  return async (_parent: any, args: Args, _context: any, _info: any) => {
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
