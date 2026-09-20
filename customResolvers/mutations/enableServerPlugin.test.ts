import assert from 'node:assert/strict'
import test from 'node:test'

import type { GraphQLResolveInfo } from 'graphql'

import type { ResolverDeps } from '../resolverDeps.js'
import type { GraphQLContext } from '../../types/context.js'
import getResolver, { parsePluginSettings } from './enableServerPlugin.js'

type Models = Pick<
  ResolverDeps,
  'Plugin' | 'PluginVersion' | 'ServerConfig' | 'ServerSecret'
>

test('parsePluginSettings accepts records and safely rejects malformed storage', () => {
  assert.deepEqual(parsePluginSettings({ retries: 3 }), { retries: 3 })
  assert.deepEqual(parsePluginSettings('{"retries":3}'), { retries: 3 })
  assert.deepEqual(parsePluginSettings(null), {})
  assert.deepEqual(parsePluginSettings('not-json'), {})
  assert.deepEqual(parsePluginSettings('[1,2]'), {})
  assert.deepEqual(parsePluginSettings(['not', 'settings']), {})
})

test('preserves installed settings when enablement omits settingsJson', async () => {
  let updateInput: unknown
  const models = {
    Plugin: {
      find: async () => [{
        id: 'plugin-node',
        name: 'security-attachment-scan',
        tags: [],
        Versions: [{
          id: 'version-node',
          version: '0.4.0',
          manifest: { settings: [] },
        }],
      }],
    },
    PluginVersion: {},
    ServerConfig: {
      find: async () => [{
        serverName: 'Topical',
        InstalledVersions: [{ id: 'version-node', version: '0.4.0' }],
        InstalledVersionsConnection: {
          edges: [{
            properties: {
              settingsJson: JSON.stringify({
                serviceUrl: 'https://scanner.example.test',
              }),
            },
          }],
        },
      }],
      update: async (input: unknown) => {
        updateInput = input
        return { serverConfigs: [] }
      },
    },
    ServerSecret: { find: async () => [] },
  } as unknown as Models

  const result = await getResolver(models)(
    {},
    {
      pluginId: 'security-attachment-scan',
      version: '0.4.0',
      enabled: true,
    },
    {} as GraphQLContext,
    {} as GraphQLResolveInfo
  )

  assert.deepEqual(result.settingsJson, {
    serviceUrl: 'https://scanner.example.test',
  })
  assert.deepEqual(updateInput, {
    where: { serverName: 'Topical' },
    update: {
      InstalledVersions: [{
        where: { node: { id: 'version-node' } },
        update: {
          edge: {
            enabled: true,
            settingsJson: JSON.stringify({
              serviceUrl: 'https://scanner.example.test',
            }),
          },
        },
      }],
    },
  })
})
