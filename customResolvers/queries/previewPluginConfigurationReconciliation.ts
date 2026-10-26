import type { Driver } from "neo4j-driver";
import { createPluginConfigurationReadRepository, type PluginConfigurationReadRepository } from "../../services/persistence/pluginConfigurationReadRepository.js";
import type { GraphQLResolveInfo } from 'graphql'

import {
  PipelineApplicability,
  PipelineCondition,
  type PluginConfigurationDesiredStateInput,
  type QueryPreviewPluginConfigurationReconciliationArgs,
} from '../../src/generated/graphql.js'
import type { GraphQLContext } from '../../types/context.js'
import {
  buildPluginConfigurationReconciliationPlan,
  type PluginConfigurationDesiredState,
  type ServerPluginSecret,
} from '../../services/plugin/configurationReconciliation.js'
import { parseStoredPipelines } from '../../services/plugin/pipelineUtils.js'
import type { EventPipeline, PipelineStep } from '../../services/plugin/types.js'

type Input = {
  driver: Driver
  pluginConfigurationReadRepository?: PluginConfigurationReadRepository
}

type InstalledVersionEdge = {
  properties?: {
    enabled?: boolean | null
    settingsJson?: unknown
  } | null
  node?: {
    version?: string | null
    Plugin?: { name?: string | null } | null
  } | null
}

const mapCondition = (
  condition: PipelineCondition | null | undefined
): PipelineStep['condition'] | undefined => {
  switch (condition) {
    case PipelineCondition.Always:
      return 'ALWAYS'
    case PipelineCondition.PreviousSucceeded:
      return 'PREVIOUS_SUCCEEDED'
    case PipelineCondition.PreviousFailed:
      return 'PREVIOUS_FAILED'
    default:
      return undefined
  }
}

const mapApplicability = (
  applicability: PipelineApplicability | null | undefined
): EventPipeline['applicability'] | undefined => {
  switch (applicability) {
    case PipelineApplicability.NewFilesOnly:
      return 'NEW_FILES_ONLY'
    case PipelineApplicability.AllFilesGradual:
      return 'ALL_FILES_GRADUAL'
    case PipelineApplicability.AllFilesImmediate:
      return 'ALL_FILES_IMMEDIATE'
    default:
      return undefined
  }
}

export const mapPluginConfigurationDesiredStateInput = (
  manifest: PluginConfigurationDesiredStateInput
): PluginConfigurationDesiredState => ({
  apiVersion: manifest.apiVersion,
  plugins: manifest.plugins.map(plugin => ({
    pluginId: plugin.pluginId,
    version: plugin.version,
    enabled: plugin.enabled,
    ...(plugin.settingsJson !== undefined
      ? { settingsJson: plugin.settingsJson }
      : {}),
    ...(plugin.requiredSecrets !== undefined
      ? { requiredSecrets: plugin.requiredSecrets }
      : {}),
    ...(plugin.secretRefs !== undefined
      ? { secretRefs: plugin.secretRefs }
      : {}),
  })),
  ...(manifest.pipelines !== undefined
    ? {
        pipelines: manifest.pipelines?.map(pipeline => ({
          event: pipeline.event,
          steps: pipeline.steps.map(step => {
            const condition = mapCondition(step.condition)
            return {
              pluginId: step.pluginId,
              ...(step.version ? { version: step.version } : {}),
              ...(step.continueOnError !== undefined && step.continueOnError !== null
                ? { continueOnError: step.continueOnError }
                : {}),
              ...(condition ? { condition } : {}),
            }
          }),
          ...(pipeline.stopOnFirstFailure !== undefined &&
          pipeline.stopOnFirstFailure !== null
            ? { stopOnFirstFailure: pipeline.stopOnFirstFailure }
            : {}),
          ...(pipeline.effectiveAt ? { effectiveAt: pipeline.effectiveAt } : {}),
          ...(pipeline.policyId ? { policyId: pipeline.policyId } : {}),
          ...(() => {
            const applicability = mapApplicability(pipeline.applicability)
            return applicability ? { applicability } : {}
          })(),
        })) ?? null,
      }
    : {}),
  ...(manifest.managedPipelineEvents !== undefined
    ? { managedPipelineEvents: manifest.managedPipelineEvents }
    : {}),
})

const mapSecretStatus = (secret: {
  pluginId: string
  key: string
  isValid?: boolean | null
  lastValidatedAt?: unknown
}): ServerPluginSecret => ({
  pluginId: secret.pluginId,
  key: secret.key,
  status: secret.lastValidatedAt
    ? (secret.isValid ? 'VALID' : 'INVALID')
    : 'SET_UNTESTED',
})

const getResolver = (input: Input) => {
  const repository = input.pluginConfigurationReadRepository ?? createPluginConfigurationReadRepository(input.driver)
  return async (
    _parent: unknown,
    args: QueryPreviewPluginConfigurationReconciliationArgs,
    _context: GraphQLContext,
    _info: GraphQLResolveInfo
  ) => {
    const configs = await repository.listReconciliationConfigs()
    const config = configs[0]
    if (!config) throw new Error('Server configuration not found')

    const edges = (
      config.InstalledVersionsConnection?.edges ?? []
    ) as InstalledVersionEdge[]
    const secrets = await repository.listReconciliationSecretStatuses()

    return buildPluginConfigurationReconciliationPlan({
      desired: mapPluginConfigurationDesiredStateInput(args.manifest),
      live: {
        plugins: edges.flatMap(edge => {
          const pluginId = edge.node?.Plugin?.name
          const version = edge.node?.version
          if (!pluginId || !version) return []
          return [{
            pluginId,
            version,
            enabled: edge.properties?.enabled ?? false,
            settingsJson: edge.properties?.settingsJson ?? {},
          }]
        }),
        secrets: secrets.map(mapSecretStatus),
        pipelines: parseStoredPipelines(config.pluginPipelines),
      },
    })
  }

}

export default getResolver
