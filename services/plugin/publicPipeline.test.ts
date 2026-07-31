import assert from 'node:assert/strict'
import test from 'node:test'
import {
  toPublicPipelineRun,
  toPublicPluginJob,
} from './publicPipeline.js'

const job = {
  id: 'job-1',
  pipelineId: 'pipeline-1',
  pluginId: 'scanner',
  pluginName: 'Scanner',
  version: '1.0.0',
  scope: 'SERVER',
  eventType: 'downloadableFile.created',
  status: 'FAILED',
  message: 'provider token=secret',
  payload: { logs: ['secret'] },
  durationMs: 12,
  executionOrder: 0,
  publicDiagnostics: JSON.stringify([
    {
      level: 'ERROR',
      code: 'SCAN_FAILED',
      message: 'The scan could not be completed.',
      details: null,
      helpUrl: null,
    },
  ]),
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:01.000Z',
}

test('maps a plugin job without exposing raw message or payload', () => {
  const result = toPublicPluginJob(job)

  assert.deepEqual(
    {
      message: result.message,
      diagnostics: result.diagnostics,
      hasPayload: 'payload' in result,
    },
    {
      message: null,
      diagnostics: [
        {
          level: 'ERROR',
          code: 'SCAN_FAILED',
          message: 'The scan could not be completed.',
          details: null,
          helpUrl: null,
        },
      ],
      hasPayload: false,
    }
  )
})

test('uses generic public messages for legacy jobs', () => {
  assert.deepEqual(
    [
      toPublicPluginJob({
        ...job,
        status: 'SUCCEEDED',
        publicDiagnostics: null,
      }).message,
      toPublicPluginJob({
        ...job,
        status: 'FAILED',
        publicDiagnostics: null,
      }).message,
    ],
    [
      'Plugin completed successfully.',
      'Plugin did not complete successfully.',
    ]
  )
})

test('uses safe skipped and active-state messages', () => {
  assert.deepEqual(
    [
      toPublicPluginJob({
        ...job,
        status: 'SKIPPED',
        skippedReason: 'Condition was not met',
        publicDiagnostics: null,
      }).message,
      toPublicPluginJob({
        ...job,
        status: 'SKIPPED',
        skippedReason: null,
        publicDiagnostics: null,
      }).message,
      toPublicPluginJob({
        ...job,
        status: 'RUNNING',
        publicDiagnostics: null,
      }).message,
    ],
    [
      'Condition was not met',
      'Plugin was skipped.',
      null,
    ]
  )
})

test('orders only jobs belonging to the requested attempt', () => {
  const result = toPublicPipelineRun({
    attempt: {
      id: 'attempt-1',
      pipelineId: 'pipeline-1',
      targetId: 'file-1',
      targetType: 'DownloadableFile',
      eventType: 'downloadableFile.created',
      scope: 'SERVER',
      status: 'FAILED',
      trigger: 'EVENT',
      attemptNumber: 1,
      queuedAt: '2026-07-30T00:00:00.000Z',
      createdAt: '2026-07-30T00:00:00.000Z',
      updatedAt: '2026-07-30T00:00:01.000Z',
    },
    jobs: [
      { ...job, id: 'job-2', executionOrder: 2 },
      { ...job, id: 'other', pipelineId: 'another-pipeline' },
      { ...job, id: 'job-1', executionOrder: 0 },
    ],
  })

  assert.deepEqual(
    result.jobs.map(item => item.id),
    ['job-1', 'job-2']
  )
})
