import type { GraphQLResolveInfo } from 'graphql'

import type {
  PluginModel,
  PluginVersionModel,
  ServerConfigModel,
  ServerSecretModel,
} from '../../ogm_types.js'
import type {
  MutationApplyPluginConfigurationArgs,
  PluginConfigurationDesiredStateInput,
} from '../../src/generated/graphql.js'
import type { GraphQLContext } from '../../types/context.js'
import type {
  EventPipeline,
} from '../../services/plugin/types.js'
import type {
  PluginConfigurationChange,
  PluginConfigurationReconciliationPlan,
} from '../../services/plugin/configurationReconciliation.js'
import enableServerPlugin from './enableServerPlugin.js'
import installPluginVersion from './installPluginVersion.js'
import setServerPluginSecret from './setServerPluginSecret.js'
import updatePluginPipelines from './updatePluginPipelines.js'
import previewPluginConfigurationReconciliation, {
  mapPluginConfigurationDesiredStateInput,
} from '../queries/previewPluginConfigurationReconciliation.js'

type Input = {
  Plugin: PluginModel
  PluginVersion: PluginVersionModel
  ServerConfig: ServerConfigModel
  ServerSecret: ServerSecretModel
}

type ApplyOperation = {
  kind: PluginConfigurationChange['kind']
  path: string
  status: 'APPLIED' | 'BLOCKED' | 'FAILED'
  message: string
}

export type PluginConfigurationApplyOperations = {
  preview: (
    manifest: PluginConfigurationDesiredStateInput
  ) => Promise<PluginConfigurationReconciliationPlan>
  install: (args: { pluginId: string; version: string }) => Promise<unknown>
  setSecret: (args: {
    pluginId: string
    key: string
    value: string
  }) => Promise<unknown>
  configure: (args: {
    pluginId: string
    version: string
    enabled: boolean
    settingsJson?: Record<string, unknown>
  }) => Promise<unknown>
  updatePipelines: (pipelines: EventPipeline[]) => Promise<unknown>
}

const buildDefaultOperations = ({
  input,
  context,
  info,
}: {
  input: Input
  context: GraphQLContext
  info: GraphQLResolveInfo
}): PluginConfigurationApplyOperations => {
  const preview = previewPluginConfigurationReconciliation({
    ServerConfig: input.ServerConfig,
    ServerSecret: input.ServerSecret,
  })
  const install = installPluginVersion(input)
  const setSecret = setServerPluginSecret({ ServerSecret: input.ServerSecret })
  const configure = enableServerPlugin(input)
  const updatePipelines = updatePluginPipelines({ ServerConfig: input.ServerConfig })

  return {
    preview: manifest => preview({}, { manifest }, context, info),
    install: args => install({}, args, context, info),
    setSecret: args => setSecret({}, args, context, info),
    configure: args => configure({}, args, context, info),
    updatePipelines: pipelines =>
      updatePipelines({}, { pipelines }, context, info),
  }
}

const redactMessage = (error: unknown, secretValues: string[]): string => {
  let message = error instanceof Error ? error.message : String(error)
  for (const value of secretValues) {
    if (value) message = message.split(value).join('[REDACTED]')
  }
  return message
}

export const createApplyPluginConfigurationResolver = (
  input: Input,
  operationsFactory: typeof buildDefaultOperations = buildDefaultOperations
) =>
  async (
    _parent: unknown,
    args: MutationApplyPluginConfigurationArgs,
    context: GraphQLContext,
    info: GraphQLResolveInfo
  ) => {
    const operations = operationsFactory({ input, context, info })
    const desired = mapPluginConfigurationDesiredStateInput(args.manifest)
    const planBefore = await operations.preview(args.manifest)
    const operationResults: ApplyOperation[] = []

    const resolutions = new Map<string, string>()
    for (const resolution of args.secretResolutions ?? []) {
      if (!resolution.valueFrom.trim() || !resolution.value) {
        throw new Error('Secret resolutions require non-empty valueFrom and value')
      }
      if (resolutions.has(resolution.valueFrom)) {
        throw new Error(`Duplicate secret resolution: ${resolution.valueFrom}`)
      }
      resolutions.set(resolution.valueFrom, resolution.value)
    }

    const declaredReferences = new Set(
      desired.plugins.flatMap(plugin =>
        (plugin.secretRefs ?? []).map(secret => secret.valueFrom)
      )
    )
    const undeclaredReferences = [...resolutions.keys()].filter(
      reference => !declaredReferences.has(reference)
    )
    if (undeclaredReferences.length > 0) {
      throw new Error(
        `Secret resolutions were not declared by the manifest: ${undeclaredReferences.join(', ')}`
      )
    }

    if (planBefore.inSync) {
      return {
        status: 'NO_CHANGES',
        message: 'Plugin configuration is already in sync',
        planBefore,
        planAfter: planBefore,
        operations: operationResults,
      }
    }

    for (const plugin of desired.plugins) {
      const pluginPath = `plugins.${plugin.pluginId}@${plugin.version}`
      for (const change of planBefore.changes.filter(
        candidate =>
          candidate.path.startsWith(`${pluginPath}.secrets.`) &&
          (candidate.kind === 'SET_SECRET' || candidate.kind === 'REPLACE_SECRET')
      )) {
        const key = change.path.slice(`${pluginPath}.secrets.`.length)
        const reference = plugin.secretRefs?.find(secret => secret.key === key)
        if (!reference || !resolutions.has(reference.valueFrom)) {
          operationResults.push({
            kind: change.kind,
            path: change.path,
            status: 'BLOCKED',
            message: reference
              ? `No resolution was supplied for ${reference.valueFrom}`
              : `Secret ${key} has no valueFrom reference`,
          })
        }
      }
    }

    if (operationResults.length > 0) {
      return {
        status: 'BLOCKED',
        message: 'Apply was blocked before making changes',
        planBefore,
        planAfter: planBefore,
        operations: operationResults,
      }
    }

    let activeChange: PluginConfigurationChange | null = null
    try {
      for (const plugin of desired.plugins) {
        const pluginPath = `plugins.${plugin.pluginId}@${plugin.version}`
        const installChange = planBefore.changes.find(
          change => change.path === pluginPath && change.kind === 'INSTALL_VERSION'
        )
        if (installChange) {
          activeChange = installChange
          await operations.install({
            pluginId: plugin.pluginId,
            version: plugin.version,
          })
          operationResults.push({
            kind: installChange.kind,
            path: installChange.path,
            status: 'APPLIED',
            message: installChange.message,
          })
        }

        for (const secret of plugin.secretRefs ?? []) {
          const secretPath = `${pluginPath}.secrets.${secret.key}`
          const secretChange = planBefore.changes.find(
            change =>
              change.path === secretPath &&
              (change.kind === 'SET_SECRET' || change.kind === 'REPLACE_SECRET')
          )
          if (!secretChange) continue
          activeChange = secretChange
          const value = resolutions.get(secret.valueFrom)
          if (value === undefined) {
            throw new Error(`Missing preflighted resolution for ${secret.valueFrom}`)
          }
          await operations.setSecret({
            pluginId: plugin.pluginId,
            key: secret.key,
            value,
          })
          operationResults.push({
            kind: secretChange.kind,
            path: secretChange.path,
            status: 'APPLIED',
            message: secretChange.message,
          })
        }

        const configurationChanges = planBefore.changes.filter(
          change =>
            change.path.startsWith(pluginPath) &&
            ['UPDATE_SETTINGS', 'ENABLE_PLUGIN', 'DISABLE_PLUGIN'].includes(change.kind)
        )
        if (configurationChanges.length > 0) {
          activeChange = configurationChanges[0]
          await operations.configure({
            pluginId: plugin.pluginId,
            version: plugin.version,
            enabled: plugin.enabled,
            ...(plugin.settingsJson !== undefined && plugin.settingsJson !== null
              ? { settingsJson: plugin.settingsJson }
              : {}),
          })
          operationResults.push(
            ...configurationChanges.map(change => ({
              kind: change.kind,
              path: change.path,
              status: 'APPLIED' as const,
              message: change.message,
            }))
          )
        }
      }

      const pipelineChange = planBefore.changes.find(
        change => change.kind === 'UPDATE_PIPELINES'
      )
      if (pipelineChange && desired.pipelines) {
        activeChange = pipelineChange
        await operations.updatePipelines(desired.pipelines)
        operationResults.push({
          kind: pipelineChange.kind,
          path: pipelineChange.path,
          status: 'APPLIED',
          message: pipelineChange.message,
        })
      }
    } catch (error: unknown) {
      const message = redactMessage(error, [...resolutions.values()])
      if (activeChange) {
        operationResults.push({
          kind: activeChange.kind,
          path: activeChange.path,
          status: 'FAILED',
          message,
        })
      }
      const planAfter = await operations.preview(args.manifest)
      return {
        status: 'FAILED',
        message: 'Apply stopped after an operation failed',
        planBefore,
        planAfter,
        operations: operationResults,
      }
    }

    const planAfter = await operations.preview(args.manifest)
    return {
      status: planAfter.inSync ? 'SUCCEEDED' : 'FAILED',
      message: planAfter.inSync
        ? 'Plugin configuration was applied and verified'
        : 'Apply completed but configuration drift remains',
      planBefore,
      planAfter,
      operations: operationResults,
    }
  }

export default createApplyPluginConfigurationResolver
