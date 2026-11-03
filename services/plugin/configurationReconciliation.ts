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
  registries?: {
    mode: 'MERGE' | 'REPLACE'
    urls: string[]
  } | null
  channelPlugins?: DesiredChannelPlugin[] | null
  pipelines?: EventPipeline[] | null
  managedPipelineEvents?: string[] | null
}

export type DesiredChannelPlugin = {
  channelUniqueName: string
  pluginId: string
  version: string
  enabled: boolean
  settingsJson?: Record<string, unknown> | null
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
  registries?: string[]
  plugins: InstalledServerPlugin[]
  channels?: Array<{
    channelUniqueName: string
    plugins: InstalledServerPlugin[]
  }>
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
  | 'UPDATE_REGISTRIES'
  | 'ENABLE_CHANNEL_PLUGIN'
  | 'DISABLE_CHANNEL_PLUGIN'
  | 'UPDATE_CHANNEL_SETTINGS'
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

const mergeScopedPipelines = ({
  current,
  desired,
  managedEvents,
}: {
  current: EventPipeline[]
  desired: EventPipeline[]
  managedEvents: string[]
}): EventPipeline[] => {
  const managed = new Set(managedEvents)
  return [
    ...current.filter(pipeline => !managed.has(pipeline.event)),
    ...desired,
  ]
}

const validateDesiredState = (
  desired: PluginConfigurationDesiredState
): void => {
  if (desired.apiVersion !== PLUGIN_CONFIGURATION_API_VERSION) {
    throw new Error(
      `Unsupported plugin configuration apiVersion: ${desired.apiVersion}`
    )
  }

  if (desired.registries) {
    if (new Set(desired.registries.urls).size !== desired.registries.urls.length) {
      throw new Error('Duplicate desired plugin registry URL')
    }
    for (const registryUrl of desired.registries.urls) {
      let parsed: URL
      try {
        parsed = new URL(registryUrl)
      } catch {
        throw new Error(`Invalid plugin registry URL: ${registryUrl}`)
      }
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
        throw new Error(`Plugin registry URLs must use HTTPS without credentials: ${registryUrl}`)
      }
    }
  }

  const channelPluginIdentities = new Set<string>()
  for (const plugin of desired.channelPlugins ?? []) {
    if (!plugin.channelUniqueName.trim() || !plugin.pluginId.trim() || !plugin.version.trim()) {
      throw new Error('Desired channel plugins require non-empty channelUniqueName, pluginId, and version')
    }
    const identity = `${plugin.channelUniqueName}:${plugin.pluginId}@${plugin.version}`
    if (channelPluginIdentities.has(identity)) {
      throw new Error(`Duplicate desired channel plugin: ${identity}`)
    }
    channelPluginIdentities.add(identity)
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

  if (
    desired.managedPipelineEvents !== undefined &&
    desired.managedPipelineEvents !== null
  ) {
    if (desired.pipelines === undefined || desired.pipelines === null) {
      throw new Error('managedPipelineEvents requires pipelines to be present')
    }
    if (desired.managedPipelineEvents.length === 0) {
      throw new Error('managedPipelineEvents must contain at least one event')
    }
    if (desired.managedPipelineEvents.some(event => !event.trim())) {
      throw new Error('managedPipelineEvents requires non-empty event names')
    }
    if (
      new Set(desired.managedPipelineEvents).size !==
      desired.managedPipelineEvents.length
    ) {
      throw new Error('Duplicate managed pipeline event')
    }

    const managedEvents = new Set(desired.managedPipelineEvents)
    const outOfScope = desired.pipelines
      .map(pipeline => pipeline.event)
      .filter(event => !managedEvents.has(event))
    if (outOfScope.length > 0) {
      throw new Error(
        `Desired pipelines are outside managedPipelineEvents: ${outOfScope.join(', ')}`
      )
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

  if (desired.registries) {
    const desiredRegistries = desired.registries.mode === 'REPLACE'
      ? desired.registries.urls
      : [...new Set([...(live.registries ?? []), ...desired.registries.urls])]
    if (!sameValue(live.registries ?? [], desiredRegistries)) {
      changes.push({
        kind: 'UPDATE_REGISTRIES',
        path: 'registries',
        message: `${desired.registries.mode === 'REPLACE' ? 'Replace' : 'Merge'} plugin registries`,
        current: live.registries ?? [],
        desired: desiredRegistries,
        blocked: false,
      })
    }
  } else {
    warnings.push('Plugin registries are unmanaged because registries was omitted')
  }

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

  for (const plugin of desired.channelPlugins ?? []) {
    const path = `channels.${plugin.channelUniqueName}.plugins.${plugin.pluginId}@${plugin.version}`
    const channel = (live.channels ?? []).find(candidate => candidate.channelUniqueName === plugin.channelUniqueName)
    if (!channel) {
      changes.push({
        kind: plugin.enabled ? 'ENABLE_CHANNEL_PLUGIN' : 'DISABLE_CHANNEL_PLUGIN',
        path: `${path}.enabled`,
        message: `Channel ${plugin.channelUniqueName} does not exist`,
        current: null,
        desired: plugin.enabled,
        blocked: true,
      })
      continue
    }
    const installed = live.plugins.some(candidate =>
      candidate.pluginId === plugin.pluginId && candidate.version === plugin.version
    ) || desired.plugins.some(candidate =>
      candidate.pluginId === plugin.pluginId && candidate.version === plugin.version
    )
    if (plugin.enabled && !installed) {
      changes.push({
        kind: 'ENABLE_CHANNEL_PLUGIN',
        path: `${path}.enabled`,
        message: `Install ${plugin.pluginId} version ${plugin.version} before enabling it for ${plugin.channelUniqueName}`,
        current: null,
        desired: true,
        blocked: true,
      })
      continue
    }
    const current = channel.plugins.find(candidate =>
      candidate.pluginId === plugin.pluginId && candidate.version === plugin.version
    )
    if (current ? current.enabled !== plugin.enabled : plugin.enabled) {
      changes.push({
        kind: plugin.enabled ? 'ENABLE_CHANNEL_PLUGIN' : 'DISABLE_CHANNEL_PLUGIN',
        path: `${path}.enabled`,
        message: `${plugin.enabled ? 'Enable' : 'Disable'} ${plugin.pluginId} version ${plugin.version} for ${plugin.channelUniqueName}`,
        current: current?.enabled ?? null,
        desired: plugin.enabled,
        blocked: false,
      })
    }
    if (plugin.enabled && plugin.settingsJson !== undefined && plugin.settingsJson !== null &&
      (!current || !sameValue(current.settingsJson, plugin.settingsJson))) {
      changes.push({
        kind: 'UPDATE_CHANNEL_SETTINGS',
        path: `${path}.settingsJson`,
        message: `Reconcile ${plugin.pluginId} settings for ${plugin.channelUniqueName}`,
        current: current ? parseStoredJson(current.settingsJson) : null,
        desired: plugin.settingsJson,
        blocked: false,
      })
    }
  }

  if (desired.channelPlugins === undefined || desired.channelPlugins === null) {
    warnings.push('Channel plugins are unmanaged because channelPlugins was omitted')
  }

  if (desired.pipelines !== undefined && desired.pipelines !== null) {
    const reconciledPipelines = desired.managedPipelineEvents
      ? mergeScopedPipelines({
          current: live.pipelines,
          desired: desired.pipelines,
          managedEvents: desired.managedPipelineEvents,
        })
      : desired.pipelines
    if (!pipelinesMatch(live.pipelines, reconciledPipelines)) {
      const scoped =
        desired.managedPipelineEvents !== undefined &&
        desired.managedPipelineEvents !== null
      changes.push({
        kind: 'UPDATE_PIPELINES',
        path: scoped ? 'pipelines.managedEvents' : 'pipelines',
        message: scoped
          ? `Reconcile server plugin pipelines for managed events: ${desired.managedPipelineEvents?.join(
              ', '
            )}`
          : 'Reconcile server plugin pipelines',
        current: live.pipelines,
        desired: reconciledPipelines,
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
