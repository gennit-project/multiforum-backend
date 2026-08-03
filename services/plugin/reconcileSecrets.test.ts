import test from 'node:test'
import assert from 'node:assert/strict'
import { migrateServerSecretRenames, planSecretRenames } from './reconcileSecrets.js'
import type { ServerSecretModel } from '../../ogm_types.js'

const oldManifest = {
  secrets: [{ key: 'OLD_API_KEY', scope: 'server' }]
}

const newManifest = {
  secrets: [{ key: 'API_KEY', scope: 'server', renamedFrom: 'OLD_API_KEY' }]
}

test('re-keys a compatible stored secret without selecting or updating ciphertext', async () => {
  const finds: unknown[] = []
  const updates: unknown[] = []
  const ServerSecret = {
    find: async (input: unknown) => {
      finds.push(input)
      return [{ id: 'secret-1', key: 'OLD_API_KEY' }]
    },
    update: async (input: unknown) => {
      updates.push(input)
      return {}
    }
  }

  const renamed = await migrateServerSecretRenames({
    ServerSecret: ServerSecret as unknown as ServerSecretModel,
    pluginId: 'scanner',
    oldManifest,
    newManifest
  })

  assert.deepEqual(renamed, [{ from: 'OLD_API_KEY', to: 'API_KEY' }])
  assert.deepEqual(finds, [{ where: { pluginId: 'scanner' }, selectionSet: '{ id key }' }])
  assert.deepEqual(updates, [{ where: { id: 'secret-1' }, update: { key: 'API_KEY' } }])
  assert.equal(JSON.stringify({ finds, updates }).includes('ciphertext'), false)
})

test('does nothing when the stored rename source is absent', () => {
  assert.deepEqual(planSecretRenames({
    oldManifest,
    newManifest,
    storedKeys: [],
    scope: 'server'
  }), [])
})

test('rejects secret collisions, ambiguous mappings, and rename chains', () => {
  assert.throws(() => planSecretRenames({
    oldManifest,
    newManifest,
    storedKeys: ['OLD_API_KEY', 'API_KEY'],
    scope: 'server'
  }), /rename collision/)

  assert.throws(() => planSecretRenames({
    oldManifest,
    newManifest: { secrets: [
      { key: 'API_KEY', scope: 'server', renamedFrom: 'OLD_API_KEY' },
      { key: 'BACKUP_KEY', scope: 'server', renamedFrom: 'OLD_API_KEY' }
    ] },
    storedKeys: ['OLD_API_KEY'],
    scope: 'server'
  }), /Ambiguous secret rename/)

  assert.throws(() => planSecretRenames({
    oldManifest,
    newManifest: { secrets: [
      { key: 'API_KEY', scope: 'server', renamedFrom: 'OLD_API_KEY' },
      { key: 'CURRENT_API_KEY', scope: 'server', renamedFrom: 'API_KEY' }
    ] },
    storedKeys: ['OLD_API_KEY'],
    scope: 'server'
  }), /rename chains/)
})
