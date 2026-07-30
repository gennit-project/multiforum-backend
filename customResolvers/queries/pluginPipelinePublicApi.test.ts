import assert from 'node:assert/strict'
import test from 'node:test'
import getApplicablePluginPipeline from './getApplicablePluginPipeline.js'
import getInternalPluginPipelineRun from './getInternalPluginPipelineRun.js'
import getPluginPipelineSummary from './getPluginPipelineSummary.js'
import getPublicPluginPipelineRun from './getPublicPluginPipelineRun.js'

const visibleFile = {
  id: 'file-1',
  uploadedAt: '2026-07-31T00:00:00.000Z',
  createdAt: '2026-07-31T00:00:00.000Z',
  permanentlyRemoved: false,
  Discussion: {
    deleted: false,
    DiscussionChannels: [{ archived: false }],
  },
}

const attempt = {
  id: 'attempt-1',
  pipelineId: 'pipeline-1',
  targetId: 'file-1',
  targetType: 'DownloadableFile',
  eventType: 'downloadableFile.created',
  scope: 'SERVER',
  status: 'SUCCEEDED',
  trigger: 'EVENT',
  attemptNumber: 1,
  queuedAt: '2026-07-31T00:00:00.000Z',
  createdAt: '2026-07-31T00:00:00.000Z',
  updatedAt: '2026-07-31T00:00:01.000Z',
}

const job = {
  id: 'job-1',
  pipelineId: 'pipeline-1',
  pluginId: 'scanner',
  pluginName: 'Scanner',
  version: '1.0.0',
  scope: 'SERVER',
  eventType: 'downloadableFile.created',
  status: 'SUCCEEDED',
  message: 'raw provider response',
  payload: { token: 'private' },
  executionOrder: 0,
  publicDiagnostics: JSON.stringify([]),
  createdAt: '2026-07-31T00:00:00.000Z',
  updatedAt: '2026-07-31T00:00:01.000Z',
}

const fileModel = {
  find: async (args: any) =>
    args.selectionSet.includes('permanentlyRemoved')
      ? [visibleFile]
      : [visibleFile],
}

test('returns an applicable pipeline before any attempt exists', async () => {
  const resolver = getApplicablePluginPipeline({
    DownloadableFile: fileModel as any,
    ServerConfig: {
      find: async () => [
        {
          pluginPipelines: [
            {
              event: 'downloadableFile.created',
              applicability: 'NEW_FILES_ONLY',
              effectiveAt: '2026-07-30T00:00:00.000Z',
              steps: [{ pluginId: 'scanner' }],
            },
          ],
          InstalledVersionsConnection: {
            edges: [
              {
                properties: { enabled: true },
                node: {
                  id: 'version-scanner',
                  version: '1.0.0',
                  manifest: JSON.stringify({
                    events: ['downloadableFile.created'],
                  }),
                  Plugin: {
                    id: 'scanner',
                    name: 'scanner',
                    displayName: 'Scanner',
                  },
                },
              },
            ],
          },
        },
      ],
    } as any,
  })

  const result = await resolver(null, {
    downloadableFileId: 'file-1',
  })

  assert.deepEqual(
    {
      required: result.required,
      reason: result.reason,
      expectedJobs: result.expectedJobs,
    },
    {
      required: true,
      reason: 'APPLICABLE',
      expectedJobs: [
        {
          pluginId: 'scanner',
          pluginName: 'Scanner',
          version: '1.0.0',
          order: 0,
          condition: 'ALWAYS',
          continueOnError: false,
        },
      ],
    }
  )
})

test('returns safe public attempt details without raw job telemetry', async () => {
  const resolver = getPublicPluginPipelineRun({
    DownloadableFile: fileModel as any,
    PluginPipelineRun: { find: async () => [attempt] } as any,
    PluginRun: { find: async () => [job] } as any,
  })

  const result = await resolver(null, { pipelineRunId: 'attempt-1' })

  assert.deepEqual(
    {
      id: result?.id,
      message: result?.jobs[0]?.message,
      hasPayload: 'payload' in (result?.jobs[0] || {}),
    },
    {
      id: 'attempt-1',
      message: 'Plugin completed successfully.',
      hasPayload: false,
    }
  )
})

test('groups public attempt history newest first through the summary API', async () => {
  const resolver = getPluginPipelineSummary({
    DownloadableFile: fileModel as any,
    PluginPipelineRun: {
      find: async () => [
        { ...attempt, id: 'attempt-2', attemptNumber: 2 },
        attempt,
      ],
    } as any,
    PluginRun: { find: async () => [job] } as any,
  })

  const result = await resolver(null, {
    targetId: 'file-1',
    targetType: 'DownloadableFile',
  })

  assert.deepEqual(
    result.attempts.map(item => ({
      id: item.id,
      jobs: item.jobs.length,
    })),
    [
      { id: 'attempt-2', jobs: 1 },
      { id: 'attempt-1', jobs: 1 },
    ]
  )
})

test('returns null when a requested public or internal attempt is missing', async () => {
  const publicResolver = getPublicPluginPipelineRun({
    DownloadableFile: fileModel as any,
    PluginPipelineRun: { find: async () => [] } as any,
    PluginRun: { find: async () => [] } as any,
  })
  const internalResolver = getInternalPluginPipelineRun({
    PluginPipelineRun: { find: async () => [] } as any,
    PluginRun: { find: async () => [] } as any,
  })

  assert.deepEqual(
    await Promise.all([
      publicResolver(null, { pipelineRunId: 'missing' }),
      internalResolver(null, { pipelineRunId: 'missing' }),
    ]),
    [null, null]
  )
})

test('returns raw telemetry only through the separately authorized internal resolver', async () => {
  const resolver = getInternalPluginPipelineRun({
    PluginPipelineRun: { find: async () => [attempt] } as any,
    PluginRun: { find: async () => [job] } as any,
  })

  const result = await resolver(null, { pipelineRunId: 'attempt-1' })

  assert.deepEqual(
    {
      attemptId: result?.attempt.id,
      payload: (result?.jobs[0] as any)?.payload,
    },
    {
      attemptId: 'attempt-1',
      payload: { token: 'private' },
    }
  )
})
