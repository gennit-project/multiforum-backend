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
    update: { pluginRegistries: { set: ['https://plugins.example.test/index.json'] } },
  }])
})

test('updates an enabled channel plugin with serialized settings', async () => {
  const calls: Record<string, unknown>[] = []
  let variables: Record<string, unknown> | undefined
  const repository = createPluginConfigurationWriteRepository(
    {} as Driver,
    async (_driver, source, input) => {
      assert.match(source, /ConfigureChannelPlugin/)
      variables = input
      calls.push(input)
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

  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0], {
    where: { uniqueName: { eq: 'moderation' }, EnabledPlugins: { none: { Plugin: { name: { eq: 'scanner' } }, version: { eq: '1.0.0' } } } },
    update: { EnabledPlugins: [{ connect: [{
      where: { node: { Plugin: { name: { eq: 'scanner' } }, version: { eq: '1.0.0' } } },
      edge: { enabled: true, settingsJson: '{"threshold":0.8}' },
    }] }] },
  })
  assert.deepEqual(variables, {
    where: { uniqueName: { eq: 'moderation' } },
    update: {
      EnabledPlugins: [{
        update: {
          where: { node: { Plugin: { name: { eq: 'scanner' } }, version: { eq: '1.0.0' } } },
          edge: { enabled: { set: true }, settingsJson: { set: '{"threshold":0.8}' } },
        },
      }],
    },
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
    where: { uniqueName: { eq: 'moderation' } },
    update: {
      EnabledPlugins: [{
        disconnect: [{
          where: { node: { Plugin: { name: { eq: 'scanner' } }, version: { eq: '1.0.0' } } },
        }],
      }],
    },
  })
})
