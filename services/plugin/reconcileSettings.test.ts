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
      dropped: ['removed', 'API_KEY'],
      reset: ['mode'],
      newDefaults: ['added']
    }
  })
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
