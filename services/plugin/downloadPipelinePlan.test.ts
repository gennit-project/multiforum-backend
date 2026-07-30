import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveDownloadPipelinePlan } from './downloadPipelinePlan.js'

const EVENT = 'downloadableFile.created'

const installedPlugin = (name = 'security-attachment-scan') => ({
  properties: { enabled: true, settingsJson: null },
  node: {
    id: `pv-${name}`,
    version: '1.0.0',
    repoUrl: '',
    tarballGsUri: '',
    entryPath: 'dist/index.js',
    manifest: JSON.stringify({ events: [EVENT] }),
    settingsDefaults: null,
    uiSchema: null,
    Plugin: {
      id: `p-${name}`,
      name,
      displayName: name,
      description: '',
      metadata: null,
    },
  },
})

test('returns expected jobs when a configured check has never run', () => {
  const plan = resolveDownloadPipelinePlan({
    event: EVENT,
    pipelines: [
      {
        event: EVENT,
        steps: [{ pluginId: 'security-attachment-scan' }],
      },
    ],
    installedPluginEdges: [installedPlugin()],
    uploadedAt: '2025-08-23T00:00:00.000Z',
  })

  assert.deepEqual(
    {
      required: plan.required,
      reason: plan.reason,
      pluginIds: plan.pluginsToRun.map(plugin => plugin.pluginId),
    },
    {
      required: true,
      reason: 'APPLICABLE',
      pluginIds: ['security-attachment-scan'],
    }
  )
})

test('grandfathers an older file under a new-files-only policy', () => {
  const plan = resolveDownloadPipelinePlan({
    event: EVENT,
    pipelines: [
      {
        event: EVENT,
        effectiveAt: '2026-07-30T00:00:00.000Z',
        applicability: 'NEW_FILES_ONLY',
        steps: [{ pluginId: 'security-attachment-scan' }],
      },
    ],
    installedPluginEdges: [installedPlugin()],
    uploadedAt: '2025-08-23T00:00:00.000Z',
  })

  assert.deepEqual(
    {
      required: plan.required,
      reason: plan.reason,
      applicability: plan.applicability,
    },
    {
      required: false,
      reason: 'UPLOADED_BEFORE_POLICY',
      applicability: 'NEW_FILES_ONLY',
    }
  )
})

test('requires a newer file under a new-files-only policy', () => {
  const plan = resolveDownloadPipelinePlan({
    event: EVENT,
    pipelines: [
      {
        event: EVENT,
        effectiveAt: '2026-07-30T00:00:00.000Z',
        applicability: 'NEW_FILES_ONLY',
        steps: [{ pluginId: 'security-attachment-scan' }],
      },
    ],
    installedPluginEdges: [installedPlugin()],
    uploadedAt: '2026-07-31T00:00:00.000Z',
  })

  assert.equal(plan.required, true)
})

test('reports no applicable plugins when configured jobs are unavailable', () => {
  const plan = resolveDownloadPipelinePlan({
    event: EVENT,
    pipelines: [
      {
        event: EVENT,
        steps: [{ pluginId: 'missing-plugin' }],
      },
    ],
    installedPluginEdges: [installedPlugin()],
  })

  assert.deepEqual(
    { required: plan.required, reason: plan.reason },
    { required: false, reason: 'NO_APPLICABLE_PLUGINS' }
  )
})

test('builds an ordered fallback pipeline from installed event plugins', () => {
  const secondPlugin = installedPlugin('content-metadata')
  const unrelatedPlugin = {
    ...installedPlugin('unrelated'),
    node: {
      ...installedPlugin('unrelated').node,
      manifest: JSON.stringify({ events: ['comment.created'] }),
    },
  }

  const plan = resolveDownloadPipelinePlan({
    event: EVENT,
    pipelines: [],
    installedPluginEdges: [
      installedPlugin(),
      secondPlugin,
      unrelatedPlugin,
    ],
  })

  assert.deepEqual(
    plan.pluginsToRun.map(({ pluginId, order, step }) => ({
      pluginId,
      order,
      condition: step.condition,
      continueOnError: step.continueOnError,
    })),
    [
      {
        pluginId: 'security-attachment-scan',
        order: 0,
        condition: 'ALWAYS',
        continueOnError: false,
      },
      {
        pluginId: 'content-metadata',
        order: 1,
        condition: 'ALWAYS',
        continueOnError: false,
      },
    ]
  )
})

test('treats a file uploaded exactly at the policy boundary as new', () => {
  const boundary = '2026-07-30T00:00:00.000Z'
  const plan = resolveDownloadPipelinePlan({
    event: EVENT,
    pipelines: [
      {
        event: EVENT,
        effectiveAt: boundary,
        applicability: 'NEW_FILES_ONLY',
        steps: [{ pluginId: 'security-attachment-scan' }],
      },
    ],
    installedPluginEdges: [installedPlugin()],
    uploadedAt: boundary,
  })

  assert.equal(plan.required, true)
})

test('applies all-files policies to older files', () => {
  const plan = resolveDownloadPipelinePlan({
    event: EVENT,
    pipelines: [
      {
        event: EVENT,
        effectiveAt: '2026-07-30T00:00:00.000Z',
        applicability: 'ALL_FILES_GRADUAL',
        steps: [{ pluginId: 'security-attachment-scan' }],
      },
    ],
    installedPluginEdges: [installedPlugin()],
    uploadedAt: '2025-08-23T00:00:00.000Z',
  })

  assert.equal(plan.required, true)
})
