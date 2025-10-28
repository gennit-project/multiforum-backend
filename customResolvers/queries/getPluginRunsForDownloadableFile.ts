import type { PluginRunModel } from '../../ogm_types.js'

type Input = {
  PluginRun: PluginRunModel
}

type Args = {
  downloadableFileId: string
}

const getResolver = (input: Input) => {
  const { PluginRun } = input

  return async (_parent: any, args: Args, _context: any, _info: any) => {
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
