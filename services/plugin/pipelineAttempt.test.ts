import assert from 'node:assert/strict'
import test from 'node:test'
import { PluginPipelineRunStatus } from '../../ogm_types.js'
import {
  buildPipelineConfigurationSnapshot,
  createPipelineAttempt,
  derivePipelineAttemptStatus,
} from './pipelineAttempt.js'

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
  const creates: unknown[] = []
  const model = {
    find: async () => [{ attemptNumber: 1 }, { attemptNumber: 3 }],
    create: async (args: unknown) => {
      creates.push(args)
      return { pluginPipelineRuns: [{ id: 'attempt-4' }] }
    },
    update: async () => ({}),
  }

  await createPipelineAttempt({
    PluginPipelineRun: model as any,
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

  assert.equal((creates[0] as any).input[0].attemptNumber, 4)
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
