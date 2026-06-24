import type {
  DownloadableFileModel,
  PluginModel,
  PluginRunModel,
  PluginVersionModel,
  ServerConfigModel,
  ServerSecretModel
} from '../../ogm_types.js'
import { triggerPluginRunsForDownloadableFile, isSupportedEvent } from '../../services/pluginRunner.js'
import type { GraphQLResolveInfo } from 'graphql'
import type { GraphQLContext } from '../../types/context.js'

type Input = {
  DownloadableFile: DownloadableFileModel
  Plugin: PluginModel
  PluginVersion: PluginVersionModel
  PluginRun: PluginRunModel
  ServerConfig: ServerConfigModel
  ServerSecret: ServerSecretModel
}

type Args = {
  downloadableFileId: string
  event: string
}

const getResolver = (input: Input) => {
  const { DownloadableFile, Plugin, PluginVersion, PluginRun, ServerConfig, ServerSecret } = input

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
      downloadableFileId,
      event,
      models: {
        DownloadableFile,
        Plugin,
        PluginVersion,
        PluginRun,
        ServerConfig,
        ServerSecret
      }
    })

    return runs
  }
}

export default getResolver
