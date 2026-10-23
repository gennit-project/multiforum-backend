import assert from 'node:assert/strict'
import test from 'node:test'
import type { Driver } from 'neo4j-driver'

import type {
  PluginEventQueueRepository,
  QueuedEventAttempt,
  QueuedEventRun,
} from '../persistence/pluginEventQueueRepository.js'
import {
  PluginEventQueueService,
  pluginEventWorkerConcurrency,
  pluginEventWorkerIntervalMs,
  pluginEventWorkerRateLimitPerMinute,
  processQueuedPluginEvents,
} from './pluginEventQueue.js'

const attempt = (
  pipelineId: string,
  targetType: 'Comment' | 'Discussion' = 'Comment'
): QueuedEventAttempt => ({
  pipelineId,
  targetId: `${targetType.toLowerCase()}-1`,
  targetType,
  targetVersion: 'revision-1',
  eventType: targetType === 'Comment'
    ? 'comment.created'
    : 'discussionChannel.created',
  channelId: 'cats',
  configurationSnapshot: JSON.stringify({
    event: targetType === 'Comment'
      ? 'comment.created'
      : 'discussionChannel.created',
    stopOnFirstFailure: true,
    steps: [],
  }),
})

const run = (pipelineId: string): QueuedEventRun => ({
  id: `run-${pipelineId}`,
  pluginId: 'moderation',
  version: '1.0.0',
  status: 'PENDING',
  executionOrder: 0,
  ruleSetVersion: 'rules-1',
  targetVersion: 'revision-1',
  retryCount: 0,
})

const repository = ({
  attempts,
  runningCount = 0,
  recentStartCount = 0,
}: {
  attempts: QueuedEventAttempt[]
  runningCount?: number
  recentStartCount?: number
}): PluginEventQueueRepository => ({
  getCapacity: async () => ({ runningCount, recentStartCount }),
  findQueuedAttempts: async limit => attempts.slice(0, limit),
  findRuns: async pipelineId => [run(pipelineId)],
  failPendingAttempt: async () => {},
})

test('drains only the capacity left by concurrency and the rolling rate limit', async () => {
  const calls: string[] = []
  const result = await processQueuedPluginEvents({
    driver: {} as Driver,
    repository: repository({
      attempts: [attempt('one'), attempt('two'), attempt('three')],
      runningCount: 1,
      recentStartCount: 8,
    }),
    concurrency: 3,
    rateLimitPerMinute: 9,
    triggerComment: async args => {
      calls.push(args.commentId)
      return []
    },
    triggerChannel: async () => [],
  })

  assert.deepEqual({ result, calls }, {
    result: { startedCount: 1, failedCount: 0 },
    calls: ['comment-1'],
  })
})

test('dispatches queued attempts to their target-specific resumable trigger', async () => {
  const calls: Array<{ type: string; maxRuns?: number }> = []
  await processQueuedPluginEvents({
    driver: {} as Driver,
    repository: repository({
      attempts: [attempt('comment'), attempt('discussion', 'Discussion')],
    }),
    concurrency: 2,
    rateLimitPerMinute: 30,
    triggerComment: async (_args, options) => {
      calls.push({ type: 'comment', maxRuns: options.execution.resume.maxRuns })
      return []
    },
    triggerChannel: async (_args, options) => {
      calls.push({ type: 'discussion', maxRuns: options.execution.resume.maxRuns })
      return []
    },
  })

  assert.deepEqual(calls, [
    { type: 'comment', maxRuns: 1 },
    { type: 'discussion', maxRuns: 1 },
  ])
})

test('does not query queued attempts when no rate capacity remains', async () => {
  let queried = false
  const result = await processQueuedPluginEvents({
    driver: {} as Driver,
    repository: {
      getCapacity: async () => ({ runningCount: 0, recentStartCount: 30 }),
      findQueuedAttempts: async () => {
        queried = true
        return []
      },
      findRuns: async () => [],
      failPendingAttempt: async () => {},
    },
    concurrency: 2,
    rateLimitPerMinute: 30,
  })

  assert.deepEqual({ result, queried }, {
    result: { startedCount: 0, failedCount: 0 },
    queried: false,
  })
})

test('terminally records an attempt that cannot be rehydrated', async () => {
  const failures: Array<{ pipelineId: string; message: string }> = []
  const result = await processQueuedPluginEvents({
    driver: {} as Driver,
    repository: {
      getCapacity: async () => ({ runningCount: 0, recentStartCount: 0 }),
      findQueuedAttempts: async () => [attempt('broken')],
      findRuns: async () => [run('broken')],
      failPendingAttempt: async (pipelineId, message) => {
        failures.push({ pipelineId, message })
      },
    },
    now: new Date('2026-10-23T12:00:00.000Z'),
    triggerComment: async () => {
      throw new Error('target was deleted')
    },
    triggerChannel: async () => [],
  })

  assert.deepEqual({ result, failures }, {
    result: { startedCount: 0, failedCount: 1 },
    failures: [{ pipelineId: 'broken', message: 'target was deleted' }],
  })
})

test('terminally records a queued discussion with no persisted channel', async () => {
  const failures: string[] = []
  const missingChannel = {
    ...attempt('broken-discussion', 'Discussion'),
    channelId: null,
  }
  const result = await processQueuedPluginEvents({
    driver: {} as Driver,
    repository: {
      getCapacity: async () => ({ runningCount: 0, recentStartCount: 0 }),
      findQueuedAttempts: async () => [missingChannel],
      findRuns: async () => [run('broken-discussion')],
      failPendingAttempt: async (_pipelineId, message) => {
        failures.push(message)
      },
    },
    triggerComment: async () => [],
    triggerChannel: async () => {
      throw new Error('channel trigger should not run')
    },
  })

  assert.deepEqual(result, { startedCount: 0, failedCount: 1 })
  assert.match(failures[0], /has no channel/)
})

test('continues draining when persisting a terminal queue failure also fails', async () => {
  const result = await processQueuedPluginEvents({
    driver: {} as Driver,
    repository: {
      getCapacity: async () => ({ runningCount: 0, recentStartCount: 0 }),
      findQueuedAttempts: async () => [attempt('broken-persistence')],
      findRuns: async () => [run('broken-persistence')],
      failPendingAttempt: async () => {
        throw new Error('database unavailable')
      },
    },
    triggerComment: async () => {
      throw 'invalid queued payload'
    },
    triggerChannel: async () => [],
  })

  assert.deepEqual(result, { startedCount: 0, failedCount: 1 })
})

test('uses conservative defaults for invalid environment limits', () => {
  const previousConcurrency = process.env.PLUGIN_EVENT_WORKER_CONCURRENCY
  const previousRate = process.env.PLUGIN_EVENT_WORKER_RATE_LIMIT_PER_MINUTE
  const previousInterval = process.env.PLUGIN_EVENT_WORKER_INTERVAL_MS
  process.env.PLUGIN_EVENT_WORKER_CONCURRENCY = '0'
  process.env.PLUGIN_EVENT_WORKER_RATE_LIMIT_PER_MINUTE = 'unlimited'
  process.env.PLUGIN_EVENT_WORKER_INTERVAL_MS = '60001'
  try {
    assert.deepEqual(
      [
        pluginEventWorkerConcurrency(),
        pluginEventWorkerRateLimitPerMinute(),
        pluginEventWorkerIntervalMs(),
      ],
      [2, 30, 10_000]
    )
  } finally {
    if (previousConcurrency === undefined) delete process.env.PLUGIN_EVENT_WORKER_CONCURRENCY
    else process.env.PLUGIN_EVENT_WORKER_CONCURRENCY = previousConcurrency
    if (previousRate === undefined) delete process.env.PLUGIN_EVENT_WORKER_RATE_LIMIT_PER_MINUTE
    else process.env.PLUGIN_EVENT_WORKER_RATE_LIMIT_PER_MINUTE = previousRate
    if (previousInterval === undefined) delete process.env.PLUGIN_EVENT_WORKER_INTERVAL_MS
    else process.env.PLUGIN_EVENT_WORKER_INTERVAL_MS = previousInterval
  }
})

test('prevents overlapping queue ticks and remains usable after completion', async () => {
  let releaseFirst: (() => void) | undefined
  let callCount = 0
  const firstTick = new Promise<void>(resolve => {
    releaseFirst = resolve
  })
  const service = new PluginEventQueueService(
    {} as Driver,
    10_000,
    async () => {
      callCount += 1
      if (callCount === 1) await firstTick
    }
  )

  const activeTick = service.tick()
  await service.tick()
  assert.equal(callCount, 1)

  releaseFirst?.()
  await activeTick
  await service.tick()
  assert.equal(callCount, 2)
})

test('starts, logs interval failures, and stops the queue timer', async () => {
  let callCount = 0
  const service = new PluginEventQueueService(
    {} as Driver,
    1,
    async () => {
      callCount += 1
      if (callCount > 1) throw new Error('temporary queue failure')
    }
  )

  await service.start()
  await new Promise(resolve => setTimeout(resolve, 15))
  service.stop()

  assert.ok(callCount > 1)
})
