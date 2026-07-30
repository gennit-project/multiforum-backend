import type {
  PluginPipelineRunCreateInput,
  PluginPipelineRunModel,
  PluginPipelineRunUpdateInput,
} from '../../ogm_types.js'
import {
  PluginPipelineRunStatus,
  PluginPipelineRunTrigger,
} from '../../ogm_types.js'
import type {
  EventPipeline,
  PipelineApplicability,
  PluginToRun,
} from './types.js'
import { createQueuedPluginRunTiming } from './executionLease.js'

export type PipelineJobStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'SKIPPED'
  | 'TIMED_OUT'
  | 'CANCELLED'

export type PipelineAttemptContext = {
  pipelineId: string
  targetId: string
  targetType: string
  targetVersion?: string | null
  eventType: string
  scope: 'SERVER' | 'CHANNEL'
  channelId?: string | null
  trigger?: PluginPipelineRunTrigger
  initiatedByUsername?: string | null
  retryOfPipelineRunId?: string | null
  applicability?: PipelineApplicability | null
  policyEffectiveAt?: string | null
  eventPipeline?: EventPipeline | null
  pluginsToRun: PluginToRun[]
}

export const buildPipelineConfigurationSnapshot = ({
  eventPipeline,
  pluginsToRun,
  applicability,
  policyEffectiveAt,
  eventType,
}: Pick<
  PipelineAttemptContext,
  | 'eventPipeline'
  | 'pluginsToRun'
  | 'applicability'
  | 'policyEffectiveAt'
  | 'eventType'
>) => ({
  event: eventPipeline?.event || eventType,
  stopOnFirstFailure: eventPipeline?.stopOnFirstFailure ?? true,
  applicability: applicability || eventPipeline?.applicability || null,
  effectiveAt: policyEffectiveAt || eventPipeline?.effectiveAt || null,
  steps: pluginsToRun.map(({ pluginId, edgeData, step, order }) => ({
    pluginId,
    version: edgeData.node.version,
    order,
    condition: step.condition || 'ALWAYS',
    continueOnError: step.continueOnError ?? false,
  })),
})

const nextAttemptNumber = async ({
  PluginPipelineRun,
  targetId,
  targetType,
  eventType,
  scope,
}: Pick<
  PipelineAttemptContext,
  'targetId' | 'targetType' | 'eventType' | 'scope'
> & {
  PluginPipelineRun: PluginPipelineRunModel
}): Promise<number> => {
  const previous = await PluginPipelineRun.find({
    where: {
      targetId,
      targetType,
      eventType,
      scope,
    },
    selectionSet: `{ attemptNumber }`,
  })

  return previous.reduce(
    (highest, attempt) => Math.max(highest, attempt.attemptNumber || 0),
    0
  ) + 1
}

export const createPipelineAttempt = async ({
  PluginPipelineRun,
  context,
  now = () => new Date().toISOString(),
}: {
  PluginPipelineRun: PluginPipelineRunModel
  context: PipelineAttemptContext
  now?: () => string
}) => {
  const timestamp = now()
  const queuedTiming = createQueuedPluginRunTiming({
    now: new Date(timestamp),
  })
  const attemptNumber = await nextAttemptNumber({
    PluginPipelineRun,
    targetId: context.targetId,
    targetType: context.targetType,
    eventType: context.eventType,
    scope: context.scope,
  })

  const result = await PluginPipelineRun.create({
    input: [
      {
        pipelineId: context.pipelineId,
        targetId: context.targetId,
        targetType: context.targetType,
        targetVersion: context.targetVersion || null,
        eventType: context.eventType,
        scope: context.scope,
        channelId: context.channelId || null,
        status: PluginPipelineRunStatus.Queued,
        trigger: context.trigger || PluginPipelineRunTrigger.Event,
        initiatedByUsername: context.initiatedByUsername || null,
        retryOfPipelineRunId: context.retryOfPipelineRunId || null,
        attemptNumber,
        configurationSnapshot: buildPipelineConfigurationSnapshot(context),
        applicability: context.applicability || null,
        policyEffectiveAt: context.policyEffectiveAt || null,
        queuedAt: queuedTiming.queuedAt,
        timeoutAt: queuedTiming.timeoutAt,
        updatedAt: timestamp,
      } as PluginPipelineRunCreateInput,
    ],
  })

  await PluginPipelineRun.update({
    where: { pipelineId: context.pipelineId },
    update: {
      status: PluginPipelineRunStatus.Running,
      startedAt: timestamp,
    } as PluginPipelineRunUpdateInput,
  })

  return result.pluginPipelineRuns[0]
}

export const derivePipelineAttemptStatus = (
  statuses: PipelineJobStatus[]
): PluginPipelineRunStatus => {
  if (statuses.some(status => status === 'RUNNING')) {
    return PluginPipelineRunStatus.Running
  }
  if (statuses.some(status => status === 'PENDING')) {
    return PluginPipelineRunStatus.Queued
  }
  if (statuses.some(status => status === 'TIMED_OUT')) {
    return PluginPipelineRunStatus.TimedOut
  }
  if (statuses.some(status => status === 'FAILED')) {
    return PluginPipelineRunStatus.Failed
  }
  if (statuses.some(status => status === 'CANCELLED')) {
    return PluginPipelineRunStatus.Cancelled
  }
  return PluginPipelineRunStatus.Succeeded
}

export const completePipelineAttempt = async ({
  PluginPipelineRun,
  pipelineId,
  statuses,
  now = () => new Date().toISOString(),
}: {
  PluginPipelineRun: PluginPipelineRunModel
  pipelineId: string
  statuses: PipelineJobStatus[]
  now?: () => string
}) => {
  const status = derivePipelineAttemptStatus(statuses)
  const finishedAt =
    status === PluginPipelineRunStatus.Running ||
    status === PluginPipelineRunStatus.Queued
      ? null
      : now()

  await PluginPipelineRun.update({
    where: { pipelineId },
    update: {
      status,
      finishedAt,
      ...(finishedAt ? { timeoutAt: null } : {}),
    } as PluginPipelineRunUpdateInput,
  })

  return status
}
