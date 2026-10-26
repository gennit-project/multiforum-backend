import assert from 'node:assert/strict'
import test from 'node:test'

import type { Driver } from 'neo4j-driver'
import { createPluginConfigurationWriteRepository } from './pluginConfigurationWriteRepository.js'

test('writes the complete registry list', async () => {
  const calls: Array<Record<string, unknown>> = []
  const repository = createPluginConfigurationWriteRepository(
    {} as Driver,
    async (_driver, source, variables) => {
      assert.match(source, /SetPluginConfigurationRegistries/)
      calls.push(variables)
      return {}
    }
  )

  await repository.setRegistries(['https://plugins.example.test/index.json'])
  assert.deepEqual(calls, [{
    where: {},
    update: { pluginRegistries: ['https://plugins.example.test/index.json'] },
  }])
})

test('connects an enabled channel plugin with serialized settings', async () => {
  let variables: Record<string, unknown> | undefined
  const repository = createPluginConfigurationWriteRepository(
    {} as Driver,
    async (_driver, source, input) => {
      assert.match(source, /ConfigureChannelPlugin/)
      variables = input
      return {}
    }
  )

  await repository.configureChannelPlugin({
    channelUniqueName: 'moderation',
    pluginId: 'scanner',
    version: '1.0.0',
    enabled: true,
    settingsJson: { threshold: 0.8 },
  })

  assert.deepEqual(variables, {
    where: { uniqueName: 'moderation' },
    connect: {
      EnabledPlugins: [{
        where: { node: { Plugin: { name: 'scanner' }, version: '1.0.0' } },
        edge: { enabled: true, settingsJson: '{"threshold":0.8}' },
        overwrite: true,
      }],
    },
    disconnect: undefined,
  })
})

test('disconnects a disabled channel plugin without carrying settings', async () => {
  let variables: Record<string, unknown> | undefined
  const repository = createPluginConfigurationWriteRepository(
    {} as Driver,
    async (_driver, _source, input) => {
      variables = input
      return {}
    }
  )

  await repository.configureChannelPlugin({
    channelUniqueName: 'moderation',
    pluginId: 'scanner',
    version: '1.0.0',
    enabled: false,
  })

  assert.deepEqual(variables, {
    where: { uniqueName: 'moderation' },
    connect: undefined,
    disconnect: {
      EnabledPlugins: [{
        where: { node: { Plugin: { name: 'scanner' }, version: '1.0.0' } },
      }],
    },
  })
})
