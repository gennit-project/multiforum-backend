import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createPluginEventRetrySchedule,
  pluginEventWorkerMaxRetries,
  pluginEventWorkerRetryBaseMs,
  pluginEventWorkerRetryMaxMs,
} from './pluginEventRetry.js'

test('schedules retries with bounded exponential backoff', () => {
  const schedules = [0, 1, 2, 3].map(currentRetryCount =>
    createPluginEventRetrySchedule({
      retryable: true,
      currentRetryCount,
      error: 'service unavailable',
      now: new Date('2026-10-23T12:00:00.000Z'),
      maxRetries: 5,
      baseDelayMs: 30_000,
      maxDelayMs: 90_000,
    })
  )

  assert.deepEqual(schedules, [
    {
      retryCount: 1,
      nextAttemptAt: '2026-10-23T12:00:30.000Z',
      message: 'service unavailable (retry 1/5 scheduled)',
    },
    {
      retryCount: 2,
      nextAttemptAt: '2026-10-23T12:01:00.000Z',
      message: 'service unavailable (retry 2/5 scheduled)',
    },
    {
      retryCount: 3,
      nextAttemptAt: '2026-10-23T12:01:30.000Z',
      message: 'service unavailable (retry 3/5 scheduled)',
    },
    {
      retryCount: 4,
      nextAttemptAt: '2026-10-23T12:01:30.000Z',
      message: 'service unavailable (retry 4/5 scheduled)',
    },
  ])
})

test('does not schedule non-retryable or exhausted failures', () => {
  assert.deepEqual(
    [
      createPluginEventRetrySchedule({
        retryable: false,
        currentRetryCount: 0,
        maxRetries: 3,
      }),
      createPluginEventRetrySchedule({
        retryable: true,
        currentRetryCount: 3,
        maxRetries: 3,
      }),
    ],
    [null, null]
  )
})

test('uses conservative defaults for invalid retry environment settings', () => {
  const previous = {
    retries: process.env.PLUGIN_EVENT_WORKER_MAX_RETRIES,
    base: process.env.PLUGIN_EVENT_WORKER_RETRY_BASE_MS,
    maximum: process.env.PLUGIN_EVENT_WORKER_RETRY_MAX_MS,
  }
  process.env.PLUGIN_EVENT_WORKER_MAX_RETRIES = '-1'
  process.env.PLUGIN_EVENT_WORKER_RETRY_BASE_MS = '999'
  process.env.PLUGIN_EVENT_WORKER_RETRY_MAX_MS = 'unbounded'
  try {
    assert.deepEqual(
      [
        pluginEventWorkerMaxRetries(),
        pluginEventWorkerRetryBaseMs(),
        pluginEventWorkerRetryMaxMs(),
      ],
      [3, 30_000, 600_000]
    )
  } finally {
    if (previous.retries === undefined) delete process.env.PLUGIN_EVENT_WORKER_MAX_RETRIES
    else process.env.PLUGIN_EVENT_WORKER_MAX_RETRIES = previous.retries
    if (previous.base === undefined) delete process.env.PLUGIN_EVENT_WORKER_RETRY_BASE_MS
    else process.env.PLUGIN_EVENT_WORKER_RETRY_BASE_MS = previous.base
    if (previous.maximum === undefined) delete process.env.PLUGIN_EVENT_WORKER_RETRY_MAX_MS
    else process.env.PLUGIN_EVENT_WORKER_RETRY_MAX_MS = previous.maximum
  }
})
