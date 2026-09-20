import type { EventPipeline } from './types.js'

export const PLUGIN_CONFIGURATION_API_VERSION = 'multiforum.gennit.dev/v1alpha1'

export type DesiredServerPlugin = {
  pluginId: string
  version: string
  enabled: boolean
  settingsJson?: Record<string, unknown> | null
  requiredSecrets?: string[] | null
  secretRefs?: Array<{ key: string; valueFrom: string }> | null
}

export type PluginConfigurationDesiredState = {
  apiVersion: string
  plugins: DesiredServerPlugin[]
  pipelines?: EventPipeline[] | null
}

export type InstalledServerPlugin = {
  pluginId: string
  version: string
  enabled: boolean
  settingsJson: unknown
}

export type ServerPluginSecret = {
  pluginId: string
  key: string
  status: 'SET_UNTESTED' | 'VALID' | 'INVALID'
}

export type PluginConfigurationLiveState = {
  plugins: InstalledServerPlugin[]
  secrets: ServerPluginSecret[]
  pipelines: EventPipeline[]
}

export type PluginConfigurationChangeKind =
  | 'INSTALL_VERSION'
  | 'UPDATE_SETTINGS'
  | 'ENABLE_PLUGIN'
  | 'DISABLE_PLUGIN'
  | 'SET_SECRET'
  | 'REPLACE_SECRET'
  | 'UPDATE_PIPELINES'

export type PluginConfigurationChange = {
  kind: PluginConfigurationChangeKind
  path: string
  message: string
  current: unknown
  desired: unknown
  blocked: boolean
}

export type PluginConfigurationReconciliationPlan = {
  apiVersion: string
  inSync: boolean
  changes: PluginConfigurationChange[]
  warnings: string[]
}

const parseStoredJson = (value: unknown): unknown => {
  if (typeof value !== 'string') return value ?? {}
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

const sortObject = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortObject)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortObject(entry)])
  )
}

const sameValue = (left: unknown, right: unknown): boolean =>
  JSON.stringify(sortObject(parseStoredJson(left))) ===
  JSON.stringify(sortObject(parseStoredJson(right)))

const normalizePipeline = (
  pipeline: EventPipeline,
  desiredPipeline?: EventPipeline
): EventPipeline => {
  const normalized: EventPipeline = {
    event: pipeline.event,
    steps: pipeline.steps.map(step => ({
      pluginId: step.pluginId,
      ...(step.version ? { version: step.version } : {}),
      continueOnError: step.continueOnError ?? false,
      condition: step.condition ?? 'ALWAYS',
    })),
    stopOnFirstFailure: pipeline.stopOnFirstFailure ?? true,
  }

  if (pipeline.event.startsWith('downloadableFile.')) {
    normalized.applicability = pipeline.applicability ?? 'NEW_FILES_ONLY'
  } else if (pipeline.applicability) {
    normalized.applicability = pipeline.applicability
  }

  if (desiredPipeline?.effectiveAt && pipeline.effectiveAt) {
    normalized.effectiveAt = pipeline.effectiveAt
  }
  if (desiredPipeline?.policyId && pipeline.policyId) {
    normalized.policyId = pipeline.policyId
  }

  return normalized
}

const pipelinesMatch = (
  current: EventPipeline[],
  desired: EventPipeline[]
): boolean => {
  if (current.length !== desired.length) return false
  const currentByEvent = new Map(current.map(pipeline => [pipeline.event, pipeline]))
  return desired.every(desiredPipeline => {
    const currentPipeline = currentByEvent.get(desiredPipeline.event)
    return Boolean(
      currentPipeline &&
      sameValue(
        normalizePipeline(currentPipeline, desiredPipeline),
        normalizePipeline(desiredPipeline, desiredPipeline)
      )
    )
  })
}

const validateDesiredState = (
  desired: PluginConfigurationDesiredState
): void => {
  if (desired.apiVersion !== PLUGIN_CONFIGURATION_API_VERSION) {
    throw new Error(
      `Unsupported plugin configuration apiVersion: ${desired.apiVersion}`
    )
  }

  const identities = new Set<string>()
  for (const plugin of desired.plugins) {
    if (!plugin.pluginId.trim() || !plugin.version.trim()) {
      throw new Error('Desired plugins require non-empty pluginId and version')
    }
    const identity = `${plugin.pluginId}@${plugin.version}`
    if (identities.has(identity)) {
      throw new Error(`Duplicate desired plugin: ${identity}`)
    }
    identities.add(identity)

    const secretRefs = plugin.secretRefs ?? []
    if (secretRefs.some(secret => !secret.key.trim() || !secret.valueFrom.trim())) {
      throw new Error(`Secret references require non-empty key and valueFrom: ${plugin.pluginId}`)
    }
    const secretKeys = [
      ...(plugin.requiredSecrets ?? []),
      ...secretRefs.map(secret => secret.key),
    ]
    if (secretKeys.some(key => !key.trim())) {
      throw new Error(`Required secret keys must be non-empty: ${plugin.pluginId}`)
    }
    if (new Set(secretKeys).size !== secretKeys.length) {
      throw new Error(`Duplicate required secret for plugin: ${plugin.pluginId}`)
    }
  }

  if (desired.pipelines) {
    const events = desired.pipelines.map(pipeline => pipeline.event)
    if (new Set(events).size !== events.length) {
      throw new Error('Duplicate desired pipeline event')
    }
    for (const pipeline of desired.pipelines) {
      if (!pipeline.event.trim() || pipeline.steps.length === 0) {
        throw new Error('Desired pipelines require an event and at least one step')
      }
      if (pipeline.steps.some(step => !step.pluginId.trim())) {
        throw new Error('Desired pipeline steps require a non-empty pluginId')
      }
    }
  }
}

export const buildPluginConfigurationReconciliationPlan = ({
  desired,
  live,
}: {
  desired: PluginConfigurationDesiredState
  live: PluginConfigurationLiveState
}): PluginConfigurationReconciliationPlan => {
  validateDesiredState(desired)
  const changes: PluginConfigurationChange[] = []
  const warnings: string[] = []

  for (const plugin of desired.plugins) {
    const path = `plugins.${plugin.pluginId}@${plugin.version}`
    const installed = live.plugins.find(
      candidate =>
        candidate.pluginId === plugin.pluginId &&
        candidate.version === plugin.version
    )

    if (!installed) {
      const installedVersions = live.plugins
        .filter(candidate => candidate.pluginId === plugin.pluginId)
        .map(candidate => candidate.version)
        .sort()
      changes.push({
        kind: 'INSTALL_VERSION',
        path,
        message: `Install ${plugin.pluginId} version ${plugin.version}`,
        current: installedVersions,
        desired: plugin.version,
        blocked: false,
      })
    }

    if (plugin.settingsJson !== undefined && plugin.settingsJson !== null) {
      if (!installed || !sameValue(installed.settingsJson, plugin.settingsJson)) {
        changes.push({
          kind: 'UPDATE_SETTINGS',
          path: `${path}.settingsJson`,
          message: `Reconcile settings for ${plugin.pluginId} version ${plugin.version}`,
          current: installed ? parseStoredJson(installed.settingsJson) : null,
          desired: plugin.settingsJson,
          blocked: false,
        })
      }
    }

    const secretKeys = [
      ...(plugin.requiredSecrets ?? []),
      ...(plugin.secretRefs ?? []).map(secret => secret.key),
    ]
    for (const key of secretKeys) {
      const secret = live.secrets.find(
        candidate => candidate.pluginId === plugin.pluginId && candidate.key === key
      )
      if (!secret) {
        changes.push({
          kind: 'SET_SECRET',
          path: `${path}.secrets.${key}`,
          message: `Provide required secret ${key} for ${plugin.pluginId}`,
          current: 'NOT_SET',
          desired: 'VALID',
          blocked: true,
        })
      } else if (secret.status === 'INVALID') {
        changes.push({
          kind: 'REPLACE_SECRET',
          path: `${path}.secrets.${key}`,
          message: `Replace invalid secret ${key} for ${plugin.pluginId}`,
          current: secret.status,
          desired: 'VALID',
          blocked: true,
        })
      }
    }

    if (!installed || installed.enabled !== plugin.enabled) {
      changes.push({
        kind: plugin.enabled ? 'ENABLE_PLUGIN' : 'DISABLE_PLUGIN',
        path: `${path}.enabled`,
        message: `${plugin.enabled ? 'Enable' : 'Disable'} ${plugin.pluginId} version ${plugin.version}`,
        current: installed?.enabled ?? null,
        desired: plugin.enabled,
        blocked: false,
      })
    }
  }

  if (desired.pipelines !== undefined && desired.pipelines !== null) {
    if (!pipelinesMatch(live.pipelines, desired.pipelines)) {
      changes.push({
        kind: 'UPDATE_PIPELINES',
        path: 'pipelines',
        message: 'Reconcile server plugin pipelines',
        current: live.pipelines,
        desired: desired.pipelines,
        blocked: false,
      })
    }
  } else {
    warnings.push('Server pipelines are unmanaged because pipelines was omitted')
  }

  return {
    apiVersion: desired.apiVersion,
    inSync: changes.length === 0,
    changes,
    warnings,
  }
}
