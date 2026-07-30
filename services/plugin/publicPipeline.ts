import { parsePublicDiagnostics } from './publicDiagnostics.js'

type PipelineAttemptRecord = {
  id: string
  pipelineId: string
  targetId: string
  targetType: string
  eventType: string
  scope: string
  channelId?: string | null
  status: string
  trigger: string
  initiatedByUsername?: string | null
  retryOfPipelineRunId?: string | null
  attemptNumber: number
  applicability?: string | null
  policyEffectiveAt?: string | null
  queuedAt?: string | null
  startedAt?: string | null
  heartbeatAt?: string | null
  timeoutAt?: string | null
  finishedAt?: string | null
  createdAt: string
  updatedAt: string
}

type PluginJobRecord = {
  id: string
  pipelineId?: string | null
  pluginId: string
  pluginName?: string | null
  version: string
  scope: string
  channelId?: string | null
  eventType: string
  status: string
  durationMs?: number | null
  executionOrder?: number | null
  skippedReason?: string | null
  publicDiagnostics?: unknown
  queuedAt?: string | null
  startedAt?: string | null
  heartbeatAt?: string | null
  timeoutAt?: string | null
  finishedAt?: string | null
  createdAt: string
  updatedAt: string
}

const publicJobMessage = ({
  status,
  skippedReason,
  hasDiagnostics,
}: {
  status: string
  skippedReason?: string | null
  hasDiagnostics: boolean
}): string | null => {
  if (hasDiagnostics) return null
  if (status === 'SUCCEEDED') return 'Plugin completed successfully.'
  if (status === 'SKIPPED') return skippedReason || 'Plugin was skipped.'
  if (status === 'FAILED') return 'Plugin did not complete successfully.'
  return null
}

export const toPublicPluginJob = (job: PluginJobRecord) => {
  const diagnostics = parsePublicDiagnostics(job.publicDiagnostics)
  return {
    id: job.id,
    pluginId: job.pluginId,
    pluginName: job.pluginName || job.pluginId,
    version: job.version,
    scope: job.scope,
    channelId: job.channelId || null,
    eventType: job.eventType,
    status: job.status,
    durationMs: job.durationMs ?? null,
    executionOrder: job.executionOrder ?? 0,
    skippedReason:
      job.status === 'SKIPPED' ? job.skippedReason || null : null,
    message: publicJobMessage({
      status: job.status,
      skippedReason: job.skippedReason,
      hasDiagnostics: diagnostics.length > 0,
    }),
    diagnostics,
    queuedAt: job.queuedAt || job.createdAt,
    startedAt: job.startedAt || null,
    heartbeatAt: job.heartbeatAt || null,
    timeoutAt: job.timeoutAt || null,
    finishedAt: job.finishedAt || null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  }
}

export const toPublicPipelineRun = ({
  attempt,
  jobs,
}: {
  attempt: PipelineAttemptRecord
  jobs: PluginJobRecord[]
}) => ({
  id: attempt.id,
  pipelineId: attempt.pipelineId,
  targetId: attempt.targetId,
  targetType: attempt.targetType,
  eventType: attempt.eventType,
  scope: attempt.scope,
  channelId: attempt.channelId || null,
  status: attempt.status,
  trigger: attempt.trigger,
  initiatedByUsername: attempt.initiatedByUsername || null,
  retryOfPipelineRunId: attempt.retryOfPipelineRunId || null,
  attemptNumber: attempt.attemptNumber,
  applicability: attempt.applicability || null,
  policyEffectiveAt: attempt.policyEffectiveAt || null,
  queuedAt: attempt.queuedAt || attempt.createdAt,
  startedAt: attempt.startedAt || null,
  heartbeatAt: attempt.heartbeatAt || null,
  timeoutAt: attempt.timeoutAt || null,
  finishedAt: attempt.finishedAt || null,
  createdAt: attempt.createdAt,
  updatedAt: attempt.updatedAt,
  jobs: jobs
    .filter(job => job.pipelineId === attempt.pipelineId)
    .sort(
      (left, right) =>
        (left.executionOrder ?? 0) - (right.executionOrder ?? 0)
    )
    .map(toPublicPluginJob),
})

export const PUBLIC_PIPELINE_ATTEMPT_SELECTION = `{
  id pipelineId targetId targetType eventType scope channelId status trigger
  initiatedByUsername retryOfPipelineRunId attemptNumber applicability
  policyEffectiveAt queuedAt startedAt heartbeatAt timeoutAt finishedAt
  createdAt updatedAt
}`

export const PUBLIC_PLUGIN_JOB_SELECTION = `{
  id pipelineId pluginId pluginName version scope channelId eventType status
  durationMs executionOrder skippedReason publicDiagnostics queuedAt startedAt
  heartbeatAt timeoutAt finishedAt createdAt updatedAt
}`
