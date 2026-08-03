import test from 'node:test'
import assert from 'node:assert/strict'
import { reconcileSettings } from './reconcileSettings.js'

const newManifest = {
  settingsDefaults: {
    server: { endpoint: 'https://default.example', mode: 'safe', retries: 2, added: true, profiles: [] }
  },
  ui: {
    forms: {
      server: [{
        title: 'Settings',
        fields: [
          { key: 'endpoint', type: 'text' },
          { key: 'mode', type: 'select', options: [{ value: 'safe' }, { value: 'fast' }] },
          { key: 'retries', type: 'number', validation: { min: 1, max: 5 } },
          { key: 'added', type: 'toggle' },
          { key: 'API_KEY', type: 'secret' }
        ]
      }]
    }
  }
}

test('carries compatible values, drops removed keys, and resets invalid values', () => {
  const result = reconcileSettings({
    oldSettings: {
      endpoint: 'https://custom.example',
      mode: 'removed-option',
      retries: 4,
      profiles: [{ id: 'custom' }],
      removed: 'old',
      API_KEY: 'must-never-carry-as-a-setting'
    },
    newManifest,
    scope: 'server'
  })

  assert.deepEqual(result, {
    settings: {
      endpoint: 'https://custom.example',
      mode: 'safe',
      retries: 4,
      added: true,
      profiles: [{ id: 'custom' }]
    },
    report: {
      carried: ['endpoint', 'retries', 'profiles'],
      renamed: [],
      renamedSecrets: [],
      dropped: ['removed', 'API_KEY'],
      reset: ['mode'],
      newDefaults: ['added']
    }
  })
})

test('carries a compatible value through an explicit one-hop rename', () => {
  const result = reconcileSettings({
    oldSettings: { endpoint: 'https://custom.example' },
    oldManifest: newManifest,
    newManifest: {
      settingsDefaults: { server: { serviceUrl: 'https://default.example' } },
      ui: { forms: { server: [{ fields: [
        { key: 'serviceUrl', renamedFrom: 'endpoint', type: 'text', validation: { pattern: '^https://' } }
      ] }] } }
    },
    scope: 'server'
  })

  assert.deepEqual(result.settings, { serviceUrl: 'https://custom.example' })
  assert.deepEqual(result.report.renamed, [{ from: 'endpoint', to: 'serviceUrl' }])
  assert.deepEqual(result.report.dropped, [])
  assert.deepEqual(result.report.newDefaults, [])
})

test('resets a renamed setting when its value is invalid for the target field', () => {
  const result = reconcileSettings({
    oldSettings: { retries: 4 },
    newManifest: {
      settingsDefaults: { server: { retryLabel: 'automatic' } },
      ui: { forms: { server: [{ fields: [
        { key: 'retryLabel', renamedFrom: 'retries', type: 'text' }
      ] }] } }
    },
    scope: 'server'
  })

  assert.deepEqual(result.settings, { retryLabel: 'automatic' })
  assert.deepEqual(result.report.renamed, [])
  assert.deepEqual(result.report.reset, ['retryLabel'])
})

test('leaves a target default new when the rename source is absent', () => {
  const result = reconcileSettings({
    oldSettings: {},
    newManifest: {
      settingsDefaults: { server: { serviceUrl: 'https://default.example' } },
      ui: { forms: { server: [{ fields: [
        { key: 'serviceUrl', renamedFrom: 'endpoint', type: 'text' }
      ] }] } }
    },
    scope: 'server'
  })

  assert.deepEqual(result.report.renamed, [])
  assert.deepEqual(result.report.newDefaults, ['serviceUrl'])
})

test('rejects rename collisions and chains', () => {
  assert.throws(() => reconcileSettings({
    oldSettings: { endpoint: 'old', serviceUrl: 'new' },
    newManifest: {
      ui: { forms: { server: [{ fields: [
        { key: 'serviceUrl', renamedFrom: 'endpoint', type: 'text' }
      ] }] } }
    },
    scope: 'server'
  }), /rename collision/)

  assert.throws(() => reconcileSettings({
    oldSettings: { endpoint: 'old' },
    newManifest: {
      ui: { forms: { server: [{ fields: [
        { key: 'serviceUrl', renamedFrom: 'endpoint', type: 'text' },
        { key: 'url', renamedFrom: 'serviceUrl', type: 'text' }
      ] }] } }
    },
    scope: 'server'
  }), /rename chains/)
})

test('supports JSON strings from Neo4j properties', () => {
  const result = reconcileSettings({
    oldSettings: '{"mode":"fast"}',
    newManifest: JSON.stringify(newManifest),
    scope: 'server'
  })

  assert.deepEqual(result.settings, {
    endpoint: 'https://default.example',
    mode: 'fast',
    retries: 2,
    added: true,
    profiles: []
  })
})
