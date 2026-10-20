import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Driver } from 'neo4j-driver'
import type { GraphQLResolveInfo } from 'graphql'
import type { GraphQLContext } from '../../types/context.js'
import type { PluginStatusRepository } from '../../services/persistence/pluginStatusRepository.js'
import factory from './getPluginConfigStatus.js'

const setup = (overrides: Partial<PluginStatusRepository> = {}) => {
  const calls: string[] = []
  const repository: PluginStatusRepository = {
    findVersion: async () => { calls.push('version'); return [{ Versions: [{ id: 'v', manifest: '{}' }] }] },
    findInstallation: async () => { calls.push('installation'); return [{ InstalledVersionsConnection: { edges: [{ properties: { settingsJson: '{}' } }] } }] },
    findSecretStatuses: async () => { calls.push('secrets'); return [] },
    ...overrides
  }
  const resolver = factory({ driver: {} as Driver, pluginStatusRepository: repository })
  const run = (scope?: 'server' | 'channel') => resolver(null, { pluginId: 'p', version: '1', scope }, {} as GraphQLContext, {} as GraphQLResolveInfo)
  return { run, calls }
}
test('default server scope reads version, installation, then redacted secret status', async () => {
  const { run, calls } = setup()
  assert.deepEqual(await run(), { isFullyConfigured: true, fields: [] })
  assert.deepEqual(calls, ['version', 'installation', 'secrets'])
})
test('channel scope does not read secrets', async () => {
  const { run, calls } = setup(); await run('channel'); assert.deepEqual(calls, ['version', 'installation'])
})
test('missing version stops before installation', async () => {
  const { run, calls } = setup({ findVersion: async () => [] })
  await assert.rejects(run(), /Failed to get plugin config status: Plugin p version 1 not found/)
  assert.deepEqual(calls, [])
})
test('missing installation stops before secrets', async () => {
  const { run, calls } = setup({ findInstallation: async () => [] })
  await assert.rejects(run(), /Failed to get plugin config status: Plugin p version 1 is not installed/)
  assert.deepEqual(calls, ['version'])
})
for (const method of ['findVersion', 'findInstallation', 'findSecretStatuses'] as const) {
  test(`${method} errors retain the resolver prefix`, async () => {
    const { run } = setup({ [method]: async () => { throw new Error('fixture error') } })
    await assert.rejects(run(), /^Error: Failed to get plugin config status: fixture error$/)
  })
}
test('only the first plugin/version/config/edge supplies status', async () => {
  const { run } = setup({
    findVersion: async () => [{ Versions: [{ id: 'first', manifest: '{}' }, { id: 'ignored', manifest: 'invalid' }] }],
    findInstallation: async id => { assert.equal(id, 'first'); return [{ InstalledVersionsConnection: { edges: [{ properties: { settingsJson: '{}' } }, { properties: { settingsJson: 'invalid' } }] } }] }
  })
  assert.deepEqual(await run(), { isFullyConfigured: true, fields: [] })
})
