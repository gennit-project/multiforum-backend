import { GraphQLError } from 'graphql'
import type { Driver } from "neo4j-driver"
import { createPipelineTargetRepository, type PipelineTargetRepository } from "../../services/persistence/pipelineTargetRepository.js"
import { resolveDownloadPipelinePlan } from '../../services/plugin/downloadPipelinePlan.js'
import { parseStoredPipelines } from '../../services/plugin/pipelineUtils.js'
import { assertPublicPipelineTargetVisible } from './pluginPipelineVisibility.js'

type ApplicablePipelineArgs = {
  downloadableFileId: string
  eventType?: string | null
  scope?: string | null
  discussionId?: string | null
  channelUniqueName?: string | null
}

const getResolver = ({
  driver,
  pipelineTargetRepository = createPipelineTargetRepository(driver),
}: {
  driver: Driver
  pipelineTargetRepository?: PipelineTargetRepository
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
  if (scope !== 'SERVER' && scope !== 'CHANNEL') {
    throw new GraphQLError('Pipeline scope must be SERVER or CHANNEL', {
      extensions: { code: 'BAD_USER_INPUT' },
    })
  }
  const target = ((): { scope: "CHANNEL"; targetId: string; channelId: string } | { scope: "SERVER"; targetId: string; channelId: null } => {
    if (scope === 'CHANNEL') {
      if (!discussionId || !channelUniqueName) {
        throw new GraphQLError(
          'Channel pipeline applicability requires a discussion and channel',
          { extensions: { code: 'BAD_USER_INPUT' } }
        )
      }
      return { scope, targetId: discussionId, channelId: channelUniqueName }
    }
    return { scope, targetId: downloadableFileId, channelId: null }
  })()

  const visibleFile = await assertPublicPipelineTargetVisible({
    repository: pipelineTargetRepository,
    targetId: downloadableFileId,
    targetType: 'DownloadableFile',
  })
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

  const files = await pipelineTargetRepository.findDownloadTiming(downloadableFileId)
  const file = files[0]
  const configs = await pipelineTargetRepository.listServerApplicabilityConfigs()
  const config = configs[0]
  let pipelines = parseStoredPipelines(config?.pluginPipelines)
  let pipelineConfigured = false

  if (target.scope === 'CHANNEL') {
    const channels = await pipelineTargetRepository.findChannelApplicabilityConfig(target.channelId)
    const channel = channels[0]
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
  )
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
    targetId: target.targetId,
    targetType: scope === 'CHANNEL' ? 'Discussion' : 'DownloadableFile',
    eventType,
    scope,
    channelId: target.channelId,
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
