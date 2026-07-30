import type {
  PluginPipelineRunModel,
  PluginRunModel,
} from '../../ogm_types.js'
import { SortDirection } from '../../ogm_types.js'

const getResolver = ({
  PluginPipelineRun,
  PluginRun,
}: {
  PluginPipelineRun: PluginPipelineRunModel
  PluginRun: PluginRunModel
}) => async (_parent: unknown, { pipelineRunId }: { pipelineRunId: string }) => {
  const attempts = await PluginPipelineRun.find({
    where: { id: pipelineRunId },
    selectionSet: `{
      id pipelineId targetId targetType eventType scope channelId status trigger
      initiatedByUsername retryOfPipelineRunId attemptNumber
      configurationSnapshot applicability policyEffectiveAt queuedAt startedAt
      heartbeatAt timeoutAt finishedAt createdAt updatedAt
    }`,
  })
  const attempt = attempts[0]
  if (!attempt) return null

  const jobs = await PluginRun.find({
    where: { pipelineId: attempt.pipelineId },
    options: { sort: [{ executionOrder: SortDirection.Asc }] },
    selectionSet: `{
      id pluginId pluginName version scope channelId eventType status message
      durationMs targetId targetType payload publicDiagnostics pipelineId
      executionOrder skippedReason leaseId queuedAt startedAt heartbeatAt
      timeoutAt finishedAt createdAt updatedAt
    }`,
  })
  return { attempt, jobs }
}

export default getResolver
