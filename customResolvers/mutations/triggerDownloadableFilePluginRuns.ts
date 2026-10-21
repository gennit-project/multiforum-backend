import { triggerPluginRunsForDownloadableFile, isSupportedEvent } from '../../services/pluginRunner.js'
import type { GraphQLResolveInfo } from 'graphql'
import type { GraphQLContext } from '../../types/context.js'

type Input = Record<string, never>

type Args = {
  downloadableFileId: string
  event: string
}

const getResolver = (_input: Input = {}) => {
  return async (
    _parent: unknown,
    args: Args,
    _context: GraphQLContext,
    _info: GraphQLResolveInfo
  ) => {
    const { downloadableFileId, event } = args

    if (!isSupportedEvent(event)) {
      throw new Error(`Unsupported plugin event: ${event}`)
    }

    const runs = await triggerPluginRunsForDownloadableFile({
      driver: _context.driver,
      downloadableFileId,
      event,
    })

    return runs
  }
}

export default getResolver
