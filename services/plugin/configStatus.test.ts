import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPluginConfigStatus, getBlockingConfigFields } from './configStatus.js'

const manifest = {
  secrets: [{ key: 'API_KEY', scope: 'server', required: true }],
  settingsDefaults: { server: { retries: 3 } },
  ui: {
    forms: {
      server: [{
        title: 'Configuration',
        fields: [
          { key: 'serviceUrl', label: 'Service URL', type: 'text', validation: { required: true, pattern: '^https://' } },
          { key: 'retries', label: 'Retries', type: 'number', validation: { required: true, min: 1 } },
          { key: 'API_KEY', label: 'Duplicate API key', type: 'secret', validation: { required: true } }
        ]
      }]
    }
  }
}

test('reports missing required settings and secrets without duplicating secrets', () => {
  const status = buildPluginConfigStatus({ manifest, settingsJson: {}, scope: 'server' })

  assert.deepEqual(status, {
    isFullyConfigured: false,
    fields: [
      { key: 'serviceUrl', label: 'Service URL', scope: 'server', kind: 'SETTING', required: true, isSet: false, isValid: false, message: 'Required setting is not set' },
      { key: 'retries', label: 'Retries', scope: 'server', kind: 'SETTING', required: true, isSet: true, isValid: true, message: null },
      { key: 'API_KEY', label: 'API_KEY', scope: 'server', kind: 'SECRET', required: true, isSet: false, isValid: false, message: 'Required secret is not set' }
    ]
  })
})

test('accepts valid saved settings and an untested but present secret', () => {
  const status = buildPluginConfigStatus({
    manifest,
    settingsJson: { serviceUrl: 'https://scanner.example' },
    secretStatuses: [{ key: 'API_KEY', status: 'SET_UNTESTED' }],
    scope: 'server'
  })

  assert.equal(status.isFullyConfigured, true)
})

test('returns all blocking fields for a structured enable error', () => {
  const status = buildPluginConfigStatus({
    manifest,
    settingsJson: { serviceUrl: 'http://insecure.example' },
    secretStatuses: [{ key: 'API_KEY', status: 'INVALID' }],
    scope: 'server'
  })

  assert.deepEqual(getBlockingConfigFields(status).map(field => field.key), ['serviceUrl', 'API_KEY'])
})
