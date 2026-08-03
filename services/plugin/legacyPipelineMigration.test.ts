import assert from 'node:assert/strict'
import test from 'node:test'
import { materializeLegacyDownloadPipelines } from './legacyPipelineMigration.js'

const edge = (name: string, events: string[]) => ({
  properties: { enabled: true, settingsJson: null },
  node: {
    id: `version-${name}`,
    version: '1.0.0',
    repoUrl: '',
    tarballGsUri: '',
    entryPath: 'dist/index.js',
    manifest: JSON.stringify({ events }),
    settingsDefaults: null,
    uiSchema: null,
    Plugin: {
      id: `plugin-${name}`,
      name,
      displayName: name,
      description: '',
      metadata: null,
    },
  },
})

test('materializes enabled legacy download hooks as explicit pipelines', () => {
  let policyNumber = 0
  const result = materializeLegacyDownloadPipelines({
    storedPipelines: [],
    installedPluginEdges: [edge('scanner', [
      'downloadableFile.created',
      'downloadableFile.downloaded',
    ])],
    effectiveAt: '2026-08-03T00:00:00.000Z',
    createPolicyId: () => `policy-${++policyNumber}`,
  })

  assert.deepEqual(result, {
    pipelines: [
      {
        event: 'downloadableFile.created',
        steps: [{
          pluginId: 'scanner',
          condition: 'ALWAYS',
          continueOnError: false,
        }],
        stopOnFirstFailure: true,
        applicability: 'ALL_FILES_IMMEDIATE',
        effectiveAt: '2026-08-03T00:00:00.000Z',
        policyId: 'policy-1',
      },
      {
        event: 'downloadableFile.downloaded',
        steps: [{
          pluginId: 'scanner',
          condition: 'ALWAYS',
          continueOnError: false,
        }],
        stopOnFirstFailure: true,
        applicability: 'ALL_FILES_IMMEDIATE',
        effectiveAt: '2026-08-03T00:00:00.000Z',
        policyId: 'policy-2',
      },
    ],
    addedEvents: [
      'downloadableFile.created',
      'downloadableFile.downloaded',
    ],
  })
})

test('preserves an existing explicit event instead of replacing it', () => {
  const existing = {
    event: 'downloadableFile.created',
    steps: [{ pluginId: 'chosen-plugin' }],
  }
  const result = materializeLegacyDownloadPipelines({
    storedPipelines: [existing],
    installedPluginEdges: [edge('scanner', ['downloadableFile.created'])],
  })

  assert.deepEqual(result, { pipelines: [existing], addedEvents: [] })
})
