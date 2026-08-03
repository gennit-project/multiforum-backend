import assert from 'node:assert/strict'
import test from 'node:test'
import { modelStub } from '../../tests/fixtures/modelStub.js'
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

const fileModel = modelStub<'DownloadableFile'>({
  find: async () => [visibleFile],
})
const discussionModel = modelStub<'Discussion'>({
  find: async () => [{
    id: 'discussion-1',
    deleted: false,
    DownloadableFiles: [{ id: 'file-1', permanentlyRemoved: false }],
    DiscussionChannels: [{ archived: false }],
  }],
})
const emptyChannelModel = modelStub<'Channel'>({ find: async () => [] })

test('returns an applicable pipeline before any attempt exists', async () => {
  const resolver = getApplicablePluginPipeline({
    Channel: emptyChannelModel,
    Discussion: discussionModel,
    DownloadableFile: fileModel,
    ServerConfig: modelStub<'ServerConfig'>({
      find: async () => [
        {
          pluginPipelines: JSON.stringify([
            {
              event: 'downloadableFile.created',
              applicability: 'NEW_FILES_ONLY',
              effectiveAt: '2026-07-30T00:00:00.000Z',
              steps: [{ pluginId: 'scanner' }],
            },
          ]),
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
    }),
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

test('returns channel-scoped applicability for the download discussion', async () => {
  const channelFileModel = modelStub<'DownloadableFile'>({
    find: async () => [{
      ...visibleFile,
      Discussion: {
        id: 'discussion-1',
        deleted: false,
        DiscussionChannels: [{
          channelUniqueName: 'cats',
          archived: false,
        }],
      },
    }],
  })
  const installedEdge = {
    properties: { enabled: true },
    node: {
      id: 'version-scanner',
      version: '1.0.0',
      manifest: JSON.stringify({
        events: ['discussionChannel.created'],
      }),
      Plugin: {
        id: 'scanner',
        name: 'scanner',
        displayName: 'Scanner',
      },
    },
  }
  const resolver = getApplicablePluginPipeline({
    Channel: modelStub<'Channel'>({
      find: async () => [{
        uniqueName: 'cats',
        pluginPipelines: JSON.stringify([{
          event: 'discussionChannel.created',
          steps: [{ pluginId: 'scanner' }],
        }]),
      }],
    }),
    Discussion: discussionModel,
    DownloadableFile: channelFileModel,
    ServerConfig: modelStub<'ServerConfig'>({
      find: async () => [{
        InstalledVersionsConnection: { edges: [installedEdge] },
      }],
    }),
  })

  const result = await resolver(null, {
    downloadableFileId: 'file-1',
    discussionId: 'discussion-1',
    channelUniqueName: 'cats',
    eventType: 'discussionChannel.created',
    scope: 'CHANNEL',
  })

  assert.deepEqual(
    {
      targetId: result.targetId,
      targetType: result.targetType,
      scope: result.scope,
      channelId: result.channelId,
      configured: result.configured,
      required: result.required,
    },
    {
      targetId: 'discussion-1',
      targetType: 'Discussion',
      scope: 'CHANNEL',
      channelId: 'cats',
      configured: true,
      required: true,
    }
  )
})

test('does not infer an unconfigured channel pipeline from server plugins', async () => {
  const channelFileModel = modelStub<'DownloadableFile'>({
    find: async () => [{
      ...visibleFile,
      Discussion: {
        id: 'discussion-1',
        deleted: false,
        DiscussionChannels: [{
          channelUniqueName: 'cats',
          archived: false,
        }],
      },
    }],
  })
  const resolver = getApplicablePluginPipeline({
    Channel: modelStub<'Channel'>({
      find: async () => [{ uniqueName: 'cats', pluginPipelines: [] }],
    }),
    Discussion: discussionModel,
    DownloadableFile: channelFileModel,
    ServerConfig: modelStub<'ServerConfig'>({
      find: async () => [{
        InstalledVersionsConnection: {
          edges: [{
            properties: { enabled: true },
            node: {
              id: 'version-scanner',
              version: '1.0.0',
              manifest: JSON.stringify({
                events: ['discussionChannel.created'],
              }),
              Plugin: { id: 'scanner', name: 'scanner' },
            },
          }],
        },
      }],
    }),
  })

  const result = await resolver(null, {
    downloadableFileId: 'file-1',
    discussionId: 'discussion-1',
    channelUniqueName: 'cats',
    eventType: 'discussionChannel.created',
    scope: 'CHANNEL',
  })

  assert.deepEqual(
    {
      configured: result.configured,
      required: result.required,
      expectedJobs: result.expectedJobs,
    },
    {
      configured: false,
      required: false,
      expectedJobs: [],
    }
  )
})

test('returns safe public attempt details without raw job telemetry', async () => {
  const resolver = getPublicPluginPipelineRun({
    Discussion: discussionModel,
    DownloadableFile: fileModel,
    PluginPipelineRun: modelStub<'PluginPipelineRun'>({
      find: async () => [attempt],
    }),
    PluginRun: modelStub<'PluginRun'>({ find: async () => [job] }),
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
    Discussion: discussionModel,
    DownloadableFile: fileModel,
    PluginPipelineRun: modelStub<'PluginPipelineRun'>({
      find: async () => [
        { ...attempt, id: 'attempt-2', attemptNumber: 2 },
        attempt,
      ],
    }),
    PluginRun: modelStub<'PluginRun'>({ find: async () => [job] }),
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

test('returns channel-scoped attempt history for a visible download discussion', async () => {
  const channelAttempt = {
    ...attempt,
    id: 'channel-attempt',
    pipelineId: 'channel-pipeline',
    targetId: 'discussion-1',
    targetType: 'Discussion',
    eventType: 'discussionChannel.created',
    scope: 'CHANNEL',
    channelId: 'cats',
  }
  const resolver = getPluginPipelineSummary({
    Discussion: discussionModel,
    DownloadableFile: fileModel,
    PluginPipelineRun: modelStub<'PluginPipelineRun'>({
      find: async () => [channelAttempt],
    }),
    PluginRun: modelStub<'PluginRun'>({
      find: async () => [{
        ...job,
        pipelineId: 'channel-pipeline',
        eventType: 'discussionChannel.created',
        scope: 'CHANNEL',
        channelId: 'cats',
      }],
    }),
  })

  const result = await resolver(null, {
    targetId: 'discussion-1',
    targetType: 'Discussion',
  })

  assert.deepEqual(
    {
      scope: result.attempts[0]?.scope,
      channelId: result.attempts[0]?.channelId,
      jobs: result.attempts[0]?.jobs.length,
    },
    {
      scope: 'CHANNEL',
      channelId: 'cats',
      jobs: 1,
    }
  )
})

test('returns null when a requested public or internal attempt is missing', async () => {
  const publicResolver = getPublicPluginPipelineRun({
    Discussion: discussionModel,
    DownloadableFile: fileModel,
    PluginPipelineRun: modelStub<'PluginPipelineRun'>({
      find: async () => [],
    }),
    PluginRun: modelStub<'PluginRun'>({ find: async () => [] }),
  })
  const internalResolver = getInternalPluginPipelineRun({
    PluginPipelineRun: modelStub<'PluginPipelineRun'>({
      find: async () => [],
    }),
    PluginRun: modelStub<'PluginRun'>({ find: async () => [] }),
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
    PluginPipelineRun: modelStub<'PluginPipelineRun'>({
      find: async () => [attempt],
    }),
    PluginRun: modelStub<'PluginRun'>({ find: async () => [job] }),
  })

  const result = await resolver(null, { pipelineRunId: 'attempt-1' })

  assert.deepEqual(
    {
      attemptId: result?.attempt.id,
      payload: result?.jobs[0]?.payload,
    },
    {
      attemptId: 'attempt-1',
      payload: { token: 'private' },
    }
  )
})
