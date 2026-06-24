import type { GraphQLResolveInfo } from 'graphql'
import type { GraphQLContext } from '../../types/context.js'
import type { PluginRunModel } from '../../ogm_types.js'

type Input = {
  PluginRun: PluginRunModel
}

type Args = {
  downloadableFileId: string
}

const getResolver = (input: Input) => {
  const { PluginRun } = input

  return async (_parent: unknown, args: Args, _context: GraphQLContext, _info: GraphQLResolveInfo) => {
    const { downloadableFileId } = args

    const runs = await PluginRun.find({
      where: ({
        AND: [
          { targetId: downloadableFileId },
          { targetType: 'DownloadableFile' }
        ]
      } as any),
      options: ({
        sort: [{ createdAt: 'DESC' }]
      } as any),
      selectionSet: `{
        id
        pluginId
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
        createdAt
        updatedAt
      }`
    })

    return runs
  }
}

export default getResolver
