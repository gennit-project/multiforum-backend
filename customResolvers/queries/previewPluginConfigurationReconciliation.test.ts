import assert from 'node:assert/strict'
import test from 'node:test'

import type { ResolverDeps } from '../resolverDeps.js'
import {
  PipelineApplicability,
  PipelineCondition,
  type QueryPreviewPluginConfigurationReconciliationArgs,
} from '../../src/generated/graphql.js'
import type { GraphQLContext } from '../../types/context.js'
import getResolver from './previewPluginConfigurationReconciliation.js'

type Models = Pick<ResolverDeps, 'ServerConfig' | 'ServerSecret'>

const args: QueryPreviewPluginConfigurationReconciliationArgs = {
  manifest: {
    apiVersion: 'multiforum.gennit.dev/v1alpha1',
    plugins: [{
      pluginId: 'security-attachment-scan',
      version: '0.4.0',
      enabled: true,
      settingsJson: { serviceUrl: 'https://scanner.example.test' },
      secretRefs: [{
        key: 'SCAN_SERVICE_API_KEY',
        valueFrom: 'env:SCAN_API_KEY',
      }],
    }],
    pipelines: [{
      event: 'downloadableFile.created',
      steps: [{
        pluginId: 'security-attachment-scan',
        version: '0.4.0',
        continueOnError: false,
        condition: PipelineCondition.Always,
      }],
      stopOnFirstFailure: true,
      applicability: PipelineApplicability.NewFilesOnly,
    }],
  },
}

test('builds a preview from persisted plugin, secret, and pipeline state', async () => {
  const models = {
    ServerConfig: {
      find: async () => [{
        pluginPipelines: JSON.stringify([{
          event: 'downloadableFile.created',
          steps: [{
            pluginId: 'security-attachment-scan',
            version: '0.4.0',
          }],
          applicability: 'NEW_FILES_ONLY',
        }]),
        InstalledVersionsConnection: {
          edges: [{
            properties: {
              enabled: true,
              settingsJson: JSON.stringify({
                serviceUrl: 'https://scanner.example.test',
              }),
            },
            node: {
              version: '0.4.0',
              Plugin: { name: 'security-attachment-scan' },
            },
          }, {
            properties: null,
            node: { version: null, Plugin: null },
          }],
        },
      }],
    },
    ServerSecret: {
      find: async () => [{
        pluginId: 'security-attachment-scan',
        key: 'SCAN_SERVICE_API_KEY',
        isValid: true,
        lastValidatedAt: '2026-09-20T00:00:00.000Z',
      }],
    },
  } as unknown as Models

  const resolver = getResolver(models)
  const result = await resolver({}, args, {} as GraphQLContext, {} as never)

  assert.equal(result.inSync, true)
  assert.deepEqual(result.changes, [])
})

test('accepts untested secrets and reports missing server configuration', async () => {
  const models = {
    ServerConfig: {
      find: async () => [{
        pluginPipelines: [],
        InstalledVersionsConnection: { edges: [] },
      }],
    },
    ServerSecret: {
      find: async () => [{
        pluginId: 'security-attachment-scan',
        key: 'SCAN_SERVICE_API_KEY',
        isValid: false,
        lastValidatedAt: null,
      }],
    },
  } as unknown as Models
  const result = await getResolver(models)(
    {},
    args,
    {} as GraphQLContext,
    {} as never
  )

  assert.ok(result.changes.every(change => change.kind !== 'SET_SECRET'))

  const missingConfigModels = {
    ...models,
    ServerConfig: { find: async () => [] },
  } as unknown as Models
  await assert.rejects(
    getResolver(missingConfigModels)(
      {},
      args,
      {} as GraphQLContext,
      {} as never
    ),
    /Server configuration not found/
  )
})
