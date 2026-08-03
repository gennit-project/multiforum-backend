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

test('rejects malformed, duplicate, self-referential, and ambiguous rename declarations', () => {
  const reconcileFields = (fields: unknown[]) => () => reconcileSettings({
    oldSettings: { endpoint: 'https://custom.example' },
    newManifest: { ui: { forms: { server: [{ fields }] } } },
    scope: 'server'
  })

  assert.throws(reconcileFields([
    { key: 'serviceUrl', renamedFrom: 42, type: 'text' }
  ]), /invalid renamedFrom/)
  assert.throws(reconcileFields([
    { key: 'endpoint', renamedFrom: 'endpoint', type: 'text' }
  ]), /cannot be renamed from itself/)
  assert.throws(reconcileFields([
    { key: 'serviceUrl', type: 'text' },
    { key: 'serviceUrl', type: 'text' }
  ]), /Ambiguous setting definition/)
  assert.throws(reconcileFields([
    { key: 'serviceUrl', renamedFrom: 'endpoint', type: 'text' },
    { key: 'backupUrl', renamedFrom: 'endpoint', type: 'text' }
  ]), /Ambiguous setting rename/)
})

test('rejects historical chains and sources that remain in the new schema', () => {
  assert.throws(() => reconcileSettings({
    oldSettings: { endpoint: 'https://custom.example' },
    oldManifest: { ui: { forms: { server: [{ fields: [
      { key: 'endpoint', renamedFrom: 'legacyUrl', type: 'text' }
    ] }] } } },
    newManifest: { ui: { forms: { server: [{ fields: [
      { key: 'serviceUrl', renamedFrom: 'endpoint', type: 'text' }
    ] }] } } },
    scope: 'server'
  }), /rename chains/)

  assert.throws(() => reconcileSettings({
    oldSettings: { endpoint: 'https://custom.example' },
    newManifest: {
      settingsDefaults: { server: { endpoint: 'https://default.example' } },
      ui: { forms: { server: [{ fields: [
        { key: 'serviceUrl', renamedFrom: 'endpoint', type: 'text' }
      ] }] } }
    },
    scope: 'server'
  }), /source "endpoint" is still declared/)
})

test('handles malformed manifests and validates defaults-only values by shape', () => {
  assert.deepEqual(reconcileSettings({
    oldSettings: '{not-json',
    newManifest: '[]',
    scope: 'server'
  }), {
    settings: {},
    report: { carried: [], renamed: [], renamedSecrets: [], dropped: [], reset: [], newDefaults: [] }
  })

  const result = reconcileSettings({
    oldSettings: { nullable: 7, list: 'not-an-array', count: 3 },
    newManifest: {
      settingsDefaults: { server: { nullable: null, list: [], count: 0 } },
      ui: { forms: { server: [{ title: 'No fields' }] } }
    },
    scope: 'server'
  })

  assert.deepEqual(result.settings, { nullable: 7, list: [], count: 3 })
  assert.deepEqual(result.report.carried, ['nullable', 'count'])
  assert.deepEqual(result.report.reset, ['list'])
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
