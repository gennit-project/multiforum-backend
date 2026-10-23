import type { Driver } from 'neo4j-driver'

import { logger } from '../../logger.js'
import {
  createPluginEventQueueRepository,
  type PluginEventQueueRepository,
  type QueuedEventAttempt,
} from '../persistence/pluginEventQueueRepository.js'
import { triggerChannelPluginPipeline } from './channelTrigger.js'
import { triggerPluginRunsForComment } from './commentTrigger.js'
import type { QueuedPipelineResume } from './types.js'

const DEFAULT_CONCURRENCY = 2
const DEFAULT_RATE_LIMIT_PER_MINUTE = 30
const DEFAULT_INTERVAL_MS = 10_000

const boundedPositiveInteger = (
  value: string | undefined,
  fallback: number,
  maximum: number
) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum
    ? parsed
    : fallback
}

export const pluginEventWorkerConcurrency = () =>
  boundedPositiveInteger(
    process.env.PLUGIN_EVENT_WORKER_CONCURRENCY,
    DEFAULT_CONCURRENCY,
    20
  )

export const pluginEventWorkerRateLimitPerMinute = () =>
  boundedPositiveInteger(
    process.env.PLUGIN_EVENT_WORKER_RATE_LIMIT_PER_MINUTE,
    DEFAULT_RATE_LIMIT_PER_MINUTE,
    1_000
  )

export const pluginEventWorkerIntervalMs = () =>
  boundedPositiveInteger(
    process.env.PLUGIN_EVENT_WORKER_INTERVAL_MS,
    DEFAULT_INTERVAL_MS,
    60_000
  )

type QueueTriggerOptions = {
  execution: {
    resume: QueuedPipelineResume
  }
}

type CommentQueueTrigger = (
  args: Parameters<typeof triggerPluginRunsForComment>[0],
  options: QueueTriggerOptions
) => Promise<unknown[]>

type ChannelQueueTrigger = (
  args: Parameters<typeof triggerChannelPluginPipeline>[0],
  options: QueueTriggerOptions
) => Promise<unknown[]>

const resumeAttempt = async ({
  attempt,
  repository,
  driver,
  triggerComment,
  triggerChannel,
  claimLimits,
}: {
  attempt: QueuedEventAttempt
  repository: PluginEventQueueRepository
  driver: Driver
  triggerComment: CommentQueueTrigger
  triggerChannel: ChannelQueueTrigger
  claimLimits: NonNullable<QueuedPipelineResume['claimLimits']>
}) => {
  const runs = await repository.findRuns(attempt.pipelineId)
  const resume: QueuedPipelineResume = {
    pipelineId: attempt.pipelineId,
    targetVersion: attempt.targetVersion,
    configurationSnapshot: attempt.configurationSnapshot,
    maxRuns: 1,
    claimLimits,
    runs: runs.map(run => ({
      id: run.id,
      pluginId: run.pluginId,
      order: run.executionOrder,
      status: run.status,
      version: run.version,
      ruleSetVersion: run.ruleSetVersion,
      targetVersion: run.targetVersion,
    })),
  }

  if (attempt.targetType === 'Comment') {
    await triggerComment(
      {
        driver,
        commentId: attempt.targetId,
        event: attempt.eventType,
      },
      { execution: { resume } }
    )
    return
  }

  if (!attempt.channelId) {
    throw new Error(`Queued discussion pipeline "${attempt.pipelineId}" has no channel`)
  }
  await triggerChannel(
    {
      driver,
      discussionId: attempt.targetId,
      channelUniqueName: attempt.channelId,
      event: attempt.eventType,
    },
    { execution: { resume } }
  )
}

export const processQueuedPluginEvents = async ({
  driver,
  repository = createPluginEventQueueRepository(driver),
  concurrency = pluginEventWorkerConcurrency(),
  rateLimitPerMinute = pluginEventWorkerRateLimitPerMinute(),
  now = new Date(),
  triggerComment = triggerPluginRunsForComment as CommentQueueTrigger,
  triggerChannel = triggerChannelPluginPipeline as ChannelQueueTrigger,
}: {
  driver: Driver
  repository?: PluginEventQueueRepository
  concurrency?: number
  rateLimitPerMinute?: number
  now?: Date
  triggerComment?: CommentQueueTrigger
  triggerChannel?: ChannelQueueTrigger
}) => {
  const capacity = await repository.getCapacity(
    new Date(now.getTime() - 60_000).toISOString()
  )
  const available = Math.min(
    Math.max(0, concurrency - capacity.runningCount),
    Math.max(0, rateLimitPerMinute - capacity.recentStartCount)
  )
  if (available === 0) return { startedCount: 0, failedCount: 0 }

  const attempts = await repository.findQueuedAttempts(available)
  const claimLimits = {
    concurrency,
    rateLimitPerMinute,
    windowStart: new Date(now.getTime() - 60_000).toISOString(),
  }
  const results = await Promise.allSettled(
    attempts.map(attempt => resumeAttempt({
      attempt,
      repository,
      driver,
      triggerComment,
      triggerChannel,
      claimLimits,
    }))
  )
  const failedCount = results.filter(result => result.status === 'rejected').length
  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      const message = result.reason instanceof Error
        ? result.reason.message
        : String(result.reason)
      logger.error('Queued plugin event execution failed', {
        pipelineId: attempts[index]?.pipelineId,
        error: message,
      })
      const pipelineId = attempts[index]?.pipelineId
      if (pipelineId) {
        try {
          await repository.failPendingAttempt(pipelineId, message, now.toISOString())
        } catch (failureError) {
          logger.error('Failed to persist queued plugin event failure', {
            pipelineId,
            error: failureError instanceof Error
              ? failureError.message
              : String(failureError),
          })
        }
      }
    }
  }

  return { startedCount: attempts.length - failedCount, failedCount }
}

export class PluginEventQueueService {
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(
    private readonly driver: Driver,
    private readonly intervalMs = pluginEventWorkerIntervalMs(),
    private readonly processEvents: (options: { driver: Driver }) => Promise<unknown> =
      processQueuedPluginEvents
  ) {}

  async tick() {
    if (this.running) return
    this.running = true
    try {
      await this.processEvents({ driver: this.driver })
    } finally {
      this.running = false
    }
  }

  async start() {
    await this.tick()
    this.timer = setInterval(() => {
      this.tick().catch(error => {
        logger.error('Plugin event queue processing failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }, this.intervalMs)
    this.timer.unref()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
