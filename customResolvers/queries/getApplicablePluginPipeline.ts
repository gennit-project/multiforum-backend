import { GraphQLError } from 'graphql'
import type {
  Channel as ChannelType,
  ChannelModel,
  DiscussionModel,
  DownloadableFile as DownloadableFileType,
  DownloadableFileModel,
  ServerConfig as ServerConfigType,
  ServerConfigModel,
} from '../../ogm_types.js'
import type { PluginEdgeData } from '../../services/plugin/types.js'
import { resolveDownloadPipelinePlan } from '../../services/plugin/downloadPipelinePlan.js'
import { parseStoredPipelines } from '../../services/plugin/pipelineUtils.js'
import { assertPublicPipelineTargetVisible } from './pluginPipelineVisibility.js'

type ApplicablePipelineArgs = {
  downloadableFileId: string
  eventType?: string
  scope?: string
  discussionId?: string | null
  channelUniqueName?: string | null
}

const getResolver = ({
  Channel,
  Discussion,
  DownloadableFile,
  ServerConfig,
}: {
  Channel: ChannelModel
  Discussion: DiscussionModel
  DownloadableFile: DownloadableFileModel
  ServerConfig: ServerConfigModel
}) => async (
  _parent: unknown,
  {
    downloadableFileId,
    eventType = 'downloadableFile.created',
    scope = 'SERVER',
    discussionId,
    channelUniqueName,
  }: ApplicablePipelineArgs
) => {
  if (!['SERVER', 'CHANNEL'].includes(scope)) {
    throw new GraphQLError('Pipeline scope must be SERVER or CHANNEL', {
      extensions: { code: 'BAD_USER_INPUT' },
    })
  }
  if (scope === 'CHANNEL' && (!discussionId || !channelUniqueName)) {
    throw new GraphQLError(
      'Channel pipeline applicability requires a discussion and channel',
      { extensions: { code: 'BAD_USER_INPUT' } }
    )
  }

  const visibleFile = await assertPublicPipelineTargetVisible({
    Discussion,
    DownloadableFile,
    targetId: downloadableFileId,
    targetType: 'DownloadableFile',
  }) as {
    Discussion?: {
      id?: string | null
      DiscussionChannels?: Array<{
        channelUniqueName?: string | null
        archived?: boolean | null
      }>
    } | null
  }
  if (
    scope === 'CHANNEL' &&
    (
      visibleFile.Discussion?.id !== discussionId ||
      !visibleFile.Discussion?.DiscussionChannels?.some(
        channel =>
          channel.channelUniqueName === channelUniqueName &&
          channel.archived !== true
      )
    )
  ) {
    throw new GraphQLError('Pipeline target not found', {
      extensions: { code: 'NOT_FOUND' },
    })
  }

  const files = await DownloadableFile.find({
    where: { id: downloadableFileId },
    selectionSet: `{ id uploadedAt createdAt }`,
  })
  const file = files[0] as DownloadableFileType
  const configs = await ServerConfig.find({
    selectionSet: `{
      pluginPipelines
      InstalledVersionsConnection {
        edges {
          properties { enabled settingsJson }
          node {
            id version repoUrl tarballGsUri entryPath manifest
            settingsDefaults uiSchema
            Plugin {
              id name displayName description metadata
            }
          }
        }
      }
    }`,
  })
  const config = configs[0] as ServerConfigType | undefined
  let pipelines = parseStoredPipelines(config?.pluginPipelines)
  let pipelineConfigured = false

  if (scope === 'CHANNEL') {
    const channels = await Channel.find({
      where: { uniqueName: channelUniqueName as string },
      selectionSet: `{ uniqueName pluginPipelines }`,
    })
    const channel = channels[0] as ChannelType | undefined
    if (!channel) {
      throw new GraphQLError('Pipeline target not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }
    pipelines = parseStoredPipelines(channel.pluginPipelines)
    pipelineConfigured = Boolean(
      pipelines.find(pipeline => pipeline.event === eventType)?.steps.length
    )
  }

  const installedPluginEdges = (
    config?.InstalledVersionsConnection?.edges || []
  ) as unknown as PluginEdgeData[]
  const plan = resolveDownloadPipelinePlan({
    event: eventType,
    pipelines,
    installedPluginEdges:
      scope === 'CHANNEL' && !pipelineConfigured
        ? []
        : installedPluginEdges,
    uploadedAt: file.uploadedAt || file.createdAt,
  })
  if (scope === 'SERVER') {
    pipelineConfigured = Boolean(plan.eventPipeline || plan.pluginsToRun.length)
  }

  return {
    targetId:
      scope === 'CHANNEL' ? discussionId as string : downloadableFileId,
    targetType: scope === 'CHANNEL' ? 'Discussion' : 'DownloadableFile',
    eventType,
    scope,
    channelId: scope === 'CHANNEL' ? channelUniqueName : null,
    configured: pipelineConfigured,
    applicability: plan.applicability,
    effectiveAt: plan.effectiveAt,
    policyId: plan.policyId,
    required: plan.required,
    reason: plan.reason,
    expectedJobs: plan.pluginsToRun.map(
      ({ pluginId, edgeData, step, order }) => ({
        pluginId,
        pluginName:
          edgeData.node.Plugin.displayName ||
          edgeData.node.Plugin.name ||
          pluginId,
        version: edgeData.node.version,
        order,
        condition: step.condition || 'ALWAYS',
        continueOnError: step.continueOnError ?? false,
      })
    ),
  }
}

export default getResolver
