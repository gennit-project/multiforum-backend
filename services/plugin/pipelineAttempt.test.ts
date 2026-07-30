import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelMap } from '../../ogm_types.js'
import { PluginPipelineRunStatus } from '../../ogm_types.js'
import { modelStub } from '../../tests/fixtures/modelStub.js'
import {
  buildPipelineConfigurationSnapshot,
  completePipelineAttempt,
  createPipelineAttempt,
  derivePipelineAttemptStatus,
} from './pipelineAttempt.js'

type AttemptCreateArgs =
  Parameters<ModelMap['PluginPipelineRun']['create']>[0]
type AttemptUpdateArgs =
  Parameters<ModelMap['PluginPipelineRun']['update']>[0]

const plugin = (pluginId: string, order: number) => ({
  pluginId,
  order,
  step: {
    pluginId,
    condition: order === 0 ? 'ALWAYS' as const : 'PREVIOUS_SUCCEEDED' as const,
    continueOnError: false,
  },
  edgeData: {
    properties: { enabled: true, settingsJson: { private: 'not snapshotted' } },
    node: {
      id: `version-${pluginId}`,
      version: '2.0.0',
      repoUrl: '',
      tarballGsUri: '',
      entryPath: '',
      manifest: null,
      settingsDefaults: null,
      uiSchema: null,
      Plugin: {
        id: pluginId,
        name: pluginId,
        displayName: pluginId,
        description: '',
        metadata: null,
      },
    },
  },
})

test('snapshots execution structure without plugin settings', () => {
  const snapshot = buildPipelineConfigurationSnapshot({
    eventPipeline: {
      event: 'downloadableFile.created',
      stopOnFirstFailure: false,
      applicability: 'NEW_FILES_ONLY',
      effectiveAt: '2026-07-30T12:00:00.000Z',
      steps: [],
    },
    applicability: 'NEW_FILES_ONLY',
    policyEffectiveAt: '2026-07-30T12:00:00.000Z',
    eventType: 'downloadableFile.created',
    pluginsToRun: [plugin('scan', 0), plugin('label', 1)],
  })

  assert.deepEqual(snapshot, {
    event: 'downloadableFile.created',
    stopOnFirstFailure: false,
    applicability: 'NEW_FILES_ONLY',
    effectiveAt: '2026-07-30T12:00:00.000Z',
    steps: [
      {
        pluginId: 'scan',
        version: '2.0.0',
        order: 0,
        condition: 'ALWAYS',
        continueOnError: false,
      },
      {
        pluginId: 'label',
        version: '2.0.0',
        order: 1,
        condition: 'PREVIOUS_SUCCEEDED',
        continueOnError: false,
      },
    ],
  })
})

test('increments the attempt number for the same target pipeline key', async () => {
  const creates: AttemptCreateArgs[] = []
  const model = modelStub<'PluginPipelineRun'>({
    find: async () => [{ attemptNumber: 1 }, { attemptNumber: 3 }],
    create: async args => {
      creates.push(args)
      return { pluginPipelineRuns: [{ id: 'attempt-4' }] }
    },
    update: async () => ({}),
  })

  await createPipelineAttempt({
    PluginPipelineRun: model,
    context: {
      pipelineId: 'pipeline-4',
      targetId: 'file-1',
      targetType: 'DownloadableFile',
      eventType: 'downloadableFile.created',
      scope: 'SERVER',
      pluginsToRun: [plugin('scan', 0)],
    },
    now: () => '2026-07-30T12:00:00.000Z',
  })

  assert.equal(creates[0]?.input[0]?.attemptNumber, 4)
})

test('derives failed before successful when a job fails', () => {
  assert.equal(
    derivePipelineAttemptStatus(['SUCCEEDED', 'FAILED', 'SKIPPED']),
    PluginPipelineRunStatus.Failed
  )
})

test('derives queued while any job remains pending', () => {
  assert.equal(
    derivePipelineAttemptStatus(['SUCCEEDED', 'PENDING']),
    PluginPipelineRunStatus.Queued
  )
})

test('derives running while any job is active', () => {
  assert.equal(
    derivePipelineAttemptStatus(['SUCCEEDED', 'RUNNING']),
    PluginPipelineRunStatus.Running
  )
})

test('derives succeeded when all jobs are successful or skipped', () => {
  assert.equal(
    derivePipelineAttemptStatus(['SUCCEEDED', 'SKIPPED']),
    PluginPipelineRunStatus.Succeeded
  )
})

test('completes a terminal attempt with a finish timestamp', async () => {
  const updates: AttemptUpdateArgs[] = []
  const status = await completePipelineAttempt({
    PluginPipelineRun: modelStub<'PluginPipelineRun'>({
      update: async args => {
        updates.push(args)
        return {}
      },
    }),
    pipelineId: 'pipeline-1',
    statuses: ['SUCCEEDED', 'FAILED'],
    now: () => '2026-07-30T13:00:00.000Z',
  })

  assert.deepEqual(
    { status, update: updates[0] },
    {
      status: PluginPipelineRunStatus.Failed,
      update: {
        where: { pipelineId: 'pipeline-1' },
        update: {
          status: PluginPipelineRunStatus.Failed,
          finishedAt: '2026-07-30T13:00:00.000Z',
        },
      },
    }
  )
})

test('keeps an active attempt without a finish timestamp', async () => {
  const updates: AttemptUpdateArgs[] = []
  const status = await completePipelineAttempt({
    PluginPipelineRun: modelStub<'PluginPipelineRun'>({
      update: async args => {
        updates.push(args)
        return {}
      },
    }),
    pipelineId: 'pipeline-2',
    statuses: ['RUNNING'],
    now: () => {
      throw new Error('active attempts must not request a finish timestamp')
    },
  })

  assert.deepEqual(
    { status, finishedAt: updates[0]?.update?.finishedAt },
    {
      status: PluginPipelineRunStatus.Running,
      finishedAt: null,
    }
  )
})

test('uses server timestamps when callers do not provide a clock', async () => {
  const creates: AttemptCreateArgs[] = []
  const updates: AttemptUpdateArgs[] = []
  const model = modelStub<'PluginPipelineRun'>({
    find: async () => [],
    create: async args => {
      creates.push(args)
      return { pluginPipelineRuns: [{ id: 'attempt-default-clock' }] }
    },
    update: async args => {
      updates.push(args)
      return {}
    },
  })

  await createPipelineAttempt({
    PluginPipelineRun: model,
    context: {
      pipelineId: 'pipeline-default-clock',
      targetId: 'file-default-clock',
      targetType: 'DownloadableFile',
      eventType: 'downloadableFile.created',
      scope: 'SERVER',
      pluginsToRun: [plugin('scan', 0)],
    },
  })
  await completePipelineAttempt({
    PluginPipelineRun: model,
    pipelineId: 'pipeline-default-clock',
    statuses: ['SUCCEEDED'],
  })

  assert.deepEqual(
    {
      queuedAtIsDate: Number.isFinite(
        Date.parse(String(creates[0]?.input[0]?.queuedAt))
      ),
      finishedAtIsDate: Number.isFinite(
        Date.parse(String(updates[1]?.update?.finishedAt))
      ),
    },
    {
      queuedAtIsDate: true,
      finishedAtIsDate: true,
    }
  )
})
