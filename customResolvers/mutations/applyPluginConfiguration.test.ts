import assert from 'node:assert/strict'
import test from 'node:test'

import type { GraphQLResolveInfo } from 'graphql'

import type { ResolverDeps } from '../resolverDeps.js'
import type {
  MutationApplyPluginConfigurationArgs,
  PluginConfigurationDesiredStateInput,
} from '../../src/generated/graphql.js'
import type { GraphQLContext } from '../../types/context.js'
import type {
  PluginConfigurationChange,
  PluginConfigurationReconciliationPlan,
} from '../../services/plugin/configurationReconciliation.js'
import {
  createApplyPluginConfigurationResolver,
  type PluginConfigurationApplyOperations,
} from './applyPluginConfiguration.js'

type Models = Pick<
  ResolverDeps,
  'Plugin' | 'PluginVersion' | 'ServerConfig' | 'ServerSecret'
>

const manifest: PluginConfigurationDesiredStateInput = {
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
    steps: [{ pluginId: 'security-attachment-scan', version: '0.4.0' }],
  }],
}

const change = (
  kind: PluginConfigurationChange['kind'],
  path: string
): PluginConfigurationChange => ({
  kind,
  path,
  message: `${kind} ${path}`,
  current: null,
  desired: true,
  blocked: kind === 'SET_SECRET' || kind === 'REPLACE_SECRET',
})

const plan = (
  changes: PluginConfigurationChange[]
): PluginConfigurationReconciliationPlan => ({
  apiVersion: 'multiforum.gennit.dev/v1alpha1',
  inSync: changes.length === 0,
  changes,
  warnings: [],
})

const models = {} as Models
const context = {} as GraphQLContext
const info = {} as GraphQLResolveInfo

const invoke = async ({
  args,
  operations,
}: {
  args: MutationApplyPluginConfigurationArgs
  operations: PluginConfigurationApplyOperations
}) => {
  const resolver = createApplyPluginConfigurationResolver(
    models,
    () => operations
  )
  return resolver({}, args, context, info)
}

test('returns NO_CHANGES without resolutions or mutating operations', async () => {
  let mutationCalls = 0
  const operations: PluginConfigurationApplyOperations = {
    preview: async () => plan([]),
    install: async () => { mutationCalls += 1 },
    setSecret: async () => { mutationCalls += 1 },
    configure: async () => { mutationCalls += 1 },
    updatePipelines: async () => { mutationCalls += 1 },
  }

  const result = await invoke({
    args: { manifest },
    operations,
  })

  assert.equal(result.status, 'NO_CHANGES')
  assert.equal(mutationCalls, 0)
  assert.deepEqual(result.operations, [])
})

test('refreshes a supplied secret when configuration is already in sync', async () => {
  const setSecretCalls: Array<{ pluginId: string; key: string; value: string }> = []
  let previewCount = 0
  const operations: PluginConfigurationApplyOperations = {
    preview: async () => {
      previewCount += 1
      return plan([])
    },
    install: async () => assert.fail('install should not run'),
    setSecret: async args => { setSecretCalls.push(args) },
    configure: async () => assert.fail('configure should not run'),
    updatePipelines: async () => assert.fail('updatePipelines should not run'),
  }

  const result = await invoke({
    args: {
      manifest,
      secretResolutions: [{
        valueFrom: 'env:SCAN_API_KEY',
        value: 'rotated-secret',
      }],
    },
    operations,
  })

  assert.equal(result.status, 'SUCCEEDED')
  assert.equal(previewCount, 2)
  assert.deepEqual(setSecretCalls, [{
    pluginId: 'security-attachment-scan',
    key: 'SCAN_SERVICE_API_KEY',
    value: 'rotated-secret',
  }])
  assert.deepEqual(result.operations, [{
    kind: 'REPLACE_SECRET',
    path: 'plugins.security-attachment-scan@0.4.0.secrets.SCAN_SERVICE_API_KEY',
    status: 'APPLIED',
    message: 'Refresh resolved secret SCAN_SERVICE_API_KEY for security-attachment-scan',
  }])
})

test('redacts a failed in-sync secret refresh', async () => {
  const operations: PluginConfigurationApplyOperations = {
    preview: async () => plan([]),
    install: async () => undefined,
    setSecret: async () => {
      throw new Error('scanner rejected rotated-secret')
    },
    configure: async () => undefined,
    updatePipelines: async () => undefined,
  }

  const result = await invoke({
    args: {
      manifest,
      secretResolutions: [{
        valueFrom: 'env:SCAN_API_KEY',
        value: 'rotated-secret',
      }],
    },
    operations,
  })

  assert.equal(result.status, 'FAILED')
  assert.deepEqual(result.operations, [{
    kind: 'REPLACE_SECRET',
    path: 'plugins.security-attachment-scan@0.4.0.secrets.SCAN_SERVICE_API_KEY',
    status: 'FAILED',
    message: 'scanner rejected [REDACTED]',
  }])
  assert.doesNotMatch(JSON.stringify(result), /rotated-secret/)
})

test('blocks before mutation when a required resolution is missing', async () => {
  const before = plan([
    change(
      'SET_SECRET',
      'plugins.security-attachment-scan@0.4.0.secrets.SCAN_SERVICE_API_KEY'
    ),
  ])
  let mutationCalls = 0
  const operations: PluginConfigurationApplyOperations = {
    preview: async () => before,
    install: async () => { mutationCalls += 1 },
    setSecret: async () => { mutationCalls += 1 },
    configure: async () => { mutationCalls += 1 },
    updatePipelines: async () => { mutationCalls += 1 },
  }

  const result = await invoke({ args: { manifest }, operations })

  assert.equal(result.status, 'BLOCKED')
  assert.equal(mutationCalls, 0)
  assert.equal(result.operations[0]?.status, 'BLOCKED')
  assert.match(result.operations[0]?.message ?? '', /env:SCAN_API_KEY/)
})

test('applies in safe order and verifies the final state', async () => {
  const pluginPath = 'plugins.security-attachment-scan@0.4.0'
  const before = plan([
    change('INSTALL_VERSION', pluginPath),
    change('UPDATE_SETTINGS', `${pluginPath}.settingsJson`),
    change('SET_SECRET', `${pluginPath}.secrets.SCAN_SERVICE_API_KEY`),
    change('ENABLE_PLUGIN', `${pluginPath}.enabled`),
    change('UPDATE_PIPELINES', 'pipelines'),
  ])
  const calls: string[] = []
  let previewCount = 0
  const operations: PluginConfigurationApplyOperations = {
    preview: async () => previewCount++ === 0 ? before : plan([]),
    install: async args => { calls.push(`install:${args.pluginId}`) },
    setSecret: async args => {
      calls.push(`secret:${args.key}`)
      assert.equal(args.value, 'resolved-secret')
    },
    configure: async args => {
      calls.push(`configure:${args.enabled}`)
      assert.deepEqual(args.settingsJson, {
        serviceUrl: 'https://scanner.example.test',
      })
    },
    updatePipelines: async pipelines => {
      calls.push(`pipelines:${pipelines.length}`)
    },
  }

  const result = await invoke({
    args: {
      manifest,
      secretResolutions: [{
        valueFrom: 'env:SCAN_API_KEY',
        value: 'resolved-secret',
      }],
    },
    operations,
  })

  assert.equal(result.status, 'SUCCEEDED')
  assert.deepEqual(calls, [
    'install:security-attachment-scan',
    'secret:SCAN_SERVICE_API_KEY',
    'configure:true',
    'pipelines:1',
  ])
  assert.deepEqual(result.operations.map(operation => operation.kind), [
    'INSTALL_VERSION',
    'SET_SECRET',
    'UPDATE_SETTINGS',
    'ENABLE_PLUGIN',
    'UPDATE_PIPELINES',
  ])
  assert.equal(result.planAfter.inSync, true)
})

test('returns partial failure details while redacting resolved secret values', async () => {
  const secretPath =
    'plugins.security-attachment-scan@0.4.0.secrets.SCAN_SERVICE_API_KEY'
  const before = plan([change('REPLACE_SECRET', secretPath)])
  let previewCount = 0
  const operations: PluginConfigurationApplyOperations = {
    preview: async () => previewCount++ === 0 ? before : before,
    install: async () => undefined,
    setSecret: async () => {
      throw new Error('scanner rejected super-secret-value')
    },
    configure: async () => undefined,
    updatePipelines: async () => undefined,
  }

  const result = await invoke({
    args: {
      manifest,
      secretResolutions: [{
        valueFrom: 'env:SCAN_API_KEY',
        value: 'super-secret-value',
      }],
    },
    operations,
  })

  assert.equal(result.status, 'FAILED')
  assert.equal(result.operations[0]?.status, 'FAILED')
  assert.match(result.operations[0]?.message ?? '', /\[REDACTED\]/)
  assert.doesNotMatch(JSON.stringify(result), /super-secret-value/)
})

test('reports failure when post-apply verification still finds drift', async () => {
  const before = plan([change('UPDATE_PIPELINES', 'pipelines')])
  const operations: PluginConfigurationApplyOperations = {
    preview: async () => before,
    install: async () => undefined,
    setSecret: async () => undefined,
    configure: async () => undefined,
    updatePipelines: async () => undefined,
  }

  const result = await invoke({ args: { manifest }, operations })

  assert.equal(result.status, 'FAILED')
  assert.match(result.message, /drift remains/)
})

test('rejects malformed, duplicate, and undeclared secret resolutions', async () => {
  const operations: PluginConfigurationApplyOperations = {
    preview: async () => plan([]),
    install: async () => undefined,
    setSecret: async () => undefined,
    configure: async () => undefined,
    updatePipelines: async () => undefined,
  }

  await assert.rejects(
    invoke({
      args: {
        manifest,
        secretResolutions: [{ valueFrom: '', value: '' }],
      },
      operations,
    }),
    /non-empty/
  )
  await assert.rejects(
    invoke({
      args: {
        manifest,
        secretResolutions: [
          { valueFrom: 'env:SCAN_API_KEY', value: 'one' },
          { valueFrom: 'env:SCAN_API_KEY', value: 'two' },
        ],
      },
      operations,
    }),
    /Duplicate secret resolution/
  )
  await assert.rejects(
    invoke({
      args: {
        manifest,
        secretResolutions: [{ valueFrom: 'env:OTHER', value: 'secret' }],
      },
      operations,
    }),
    /not declared/
  )
})

test('blocks legacy requiredSecrets that do not declare valueFrom', async () => {
  const legacyManifest: PluginConfigurationDesiredStateInput = {
    ...manifest,
    plugins: [{
      pluginId: 'security-attachment-scan',
      version: '0.4.0',
      enabled: true,
      requiredSecrets: ['SCAN_SERVICE_API_KEY'],
    }],
  }
  const secretPath =
    'plugins.security-attachment-scan@0.4.0.secrets.SCAN_SERVICE_API_KEY'
  const before = plan([change('SET_SECRET', secretPath)])
  const operations: PluginConfigurationApplyOperations = {
    preview: async () => before,
    install: async () => undefined,
    setSecret: async () => undefined,
    configure: async () => undefined,
    updatePipelines: async () => undefined,
  }

  const result = await invoke({
    args: { manifest: legacyManifest },
    operations,
  })

  assert.equal(result.status, 'BLOCKED')
  assert.match(result.operations[0]?.message ?? '', /no valueFrom reference/)
})
