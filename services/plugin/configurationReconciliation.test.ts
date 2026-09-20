import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildPluginConfigurationReconciliationPlan,
  PLUGIN_CONFIGURATION_API_VERSION,
  type PluginConfigurationDesiredState,
  type PluginConfigurationLiveState,
} from './configurationReconciliation.js'

const desired = (
  overrides: Partial<PluginConfigurationDesiredState> = {}
): PluginConfigurationDesiredState => ({
  apiVersion: PLUGIN_CONFIGURATION_API_VERSION,
  plugins: [{
    pluginId: 'security-attachment-scan',
    version: '0.4.0',
    enabled: true,
    settingsJson: { serviceUrl: 'https://scanner.example.test' },
    requiredSecrets: ['SCAN_SERVICE_API_KEY'],
  }],
  pipelines: [{
    event: 'downloadableFile.created',
    steps: [{ pluginId: 'security-attachment-scan', version: '0.4.0' }],
    applicability: 'NEW_FILES_ONLY',
  }],
  ...overrides,
})

const live = (
  overrides: Partial<PluginConfigurationLiveState> = {}
): PluginConfigurationLiveState => ({
  plugins: [{
    pluginId: 'security-attachment-scan',
    version: '0.4.0',
    enabled: true,
    settingsJson: JSON.stringify({ serviceUrl: 'https://scanner.example.test' }),
  }],
  secrets: [{
    pluginId: 'security-attachment-scan',
    key: 'SCAN_SERVICE_API_KEY',
    status: 'VALID',
  }],
  pipelines: [{
    event: 'downloadableFile.created',
    steps: [{
      pluginId: 'security-attachment-scan',
      version: '0.4.0',
      condition: 'ALWAYS',
      continueOnError: false,
    }],
    stopOnFirstFailure: true,
    applicability: 'NEW_FILES_ONLY',
    effectiveAt: '2026-09-20T00:00:00.000Z',
    policyId: 'generated-policy-id',
  }],
  ...overrides,
})

test('returns an in-sync plan while ignoring generated pipeline metadata', () => {
  const plan = buildPluginConfigurationReconciliationPlan({
    desired: desired(),
    live: live(),
  })

  assert.equal(plan.inSync, true)
  assert.deepEqual(plan.changes, [])
  assert.deepEqual(plan.warnings, [])
})

test('plans install, configuration, enablement, secret, and pipeline drift', () => {
  const plan = buildPluginConfigurationReconciliationPlan({
    desired: desired(),
    live: live({ plugins: [], secrets: [], pipelines: [] }),
  })

  assert.equal(plan.inSync, false)
  assert.deepEqual(plan.changes.map(change => change.kind), [
    'INSTALL_VERSION',
    'UPDATE_SETTINGS',
    'SET_SECRET',
    'ENABLE_PLUGIN',
    'UPDATE_PIPELINES',
  ])
  assert.equal(plan.changes.find(change => change.kind === 'SET_SECRET')?.blocked, true)
})

test('plans disabling and settings changes for an installed version', () => {
  const plan = buildPluginConfigurationReconciliationPlan({
    desired: desired({
      plugins: [{
        pluginId: 'security-attachment-scan',
        version: '0.4.0',
        enabled: false,
        settingsJson: { serviceUrl: 'https://new.example.test' },
      }],
      pipelines: undefined,
    }),
    live: live(),
  })

  assert.deepEqual(plan.changes.map(change => change.kind), [
    'UPDATE_SETTINGS',
    'DISABLE_PLUGIN',
  ])
  assert.deepEqual(plan.warnings, [
    'Server pipelines are unmanaged because pipelines was omitted',
  ])
})

test('reports invalid and untested secrets without exposing values', () => {
  const plan = buildPluginConfigurationReconciliationPlan({
    desired: desired({
      plugins: [{
        pluginId: 'security-attachment-scan',
        version: '0.4.0',
        enabled: true,
        requiredSecrets: ['INVALID_KEY', 'UNTESTED_KEY'],
      }],
      pipelines: null,
    }),
    live: live({
      secrets: [
        { pluginId: 'security-attachment-scan', key: 'INVALID_KEY', status: 'INVALID' },
        { pluginId: 'security-attachment-scan', key: 'UNTESTED_KEY', status: 'SET_UNTESTED' },
      ],
    }),
  })

  assert.deepEqual(plan.changes.map(change => change.kind), [
    'REPLACE_SECRET',
    'VALIDATE_SECRET',
  ])
  assert.ok(plan.changes.every(change => change.blocked))
})

test('treats explicit pipeline metadata as managed', () => {
  const plan = buildPluginConfigurationReconciliationPlan({
    desired: desired({
      pipelines: [{
        event: 'downloadableFile.created',
        steps: [{ pluginId: 'security-attachment-scan', version: '0.4.0' }],
        applicability: 'NEW_FILES_ONLY',
        policyId: 'different-policy-id',
      }],
    }),
    live: live(),
  })

  assert.deepEqual(plan.changes.map(change => change.kind), ['UPDATE_PIPELINES'])
})

test('rejects unsupported versions and duplicate declarations', () => {
  assert.throws(
    () => buildPluginConfigurationReconciliationPlan({
      desired: desired({ apiVersion: 'multiforum.gennit.dev/v99' }),
      live: live(),
    }),
    /Unsupported plugin configuration apiVersion/
  )

  assert.throws(
    () => buildPluginConfigurationReconciliationPlan({
      desired: desired({
        plugins: [desired().plugins[0], desired().plugins[0]],
      }),
      live: live(),
    }),
    /Duplicate desired plugin/
  )

  assert.throws(
    () => buildPluginConfigurationReconciliationPlan({
      desired: desired({
        plugins: [{
          ...desired().plugins[0],
          requiredSecrets: ['KEY', 'KEY'],
        }],
      }),
      live: live(),
    }),
    /Duplicate required secret/
  )

  assert.throws(
    () => buildPluginConfigurationReconciliationPlan({
      desired: desired({
        pipelines: [desired().pipelines![0], desired().pipelines![0]],
      }),
      live: live(),
    }),
    /Duplicate desired pipeline event/
  )

  for (const invalidState of [
    desired({ plugins: [{ pluginId: '', version: '0.4.0', enabled: true }] }),
    desired({
      plugins: [{
        pluginId: 'security-attachment-scan',
        version: '0.4.0',
        enabled: true,
        requiredSecrets: [''],
      }],
    }),
    desired({ pipelines: [{ event: '', steps: [] }] }),
    desired({
      pipelines: [{
        event: 'downloadableFile.created',
        steps: [{ pluginId: '' }],
      }],
    }),
  ]) {
    assert.throws(
      () => buildPluginConfigurationReconciliationPlan({
        desired: invalidState,
        live: live(),
      }),
      /require|non-empty/
    )
  }
})
