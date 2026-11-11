import type { EventPipeline, PluginEdgeData, PluginToRun } from './types.js'
import { compareVersions, getPluginForStep, parseManifest } from './pipelineUtils.js'

export const MODERATION_PLUGIN_ID = 'llm-moderation'

/** Stored server settings, not manifest defaults, are the authority for policy. */
export const parseModerationSettings = (value: unknown): Record<string, unknown> => {
  if (typeof value === 'string') {
    try { return parseModerationSettings(JSON.parse(value)) } catch { return {} }
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

const hasPolicyValue = (settings: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(settings, key) ||
  Object.prototype.hasOwnProperty.call(parseModerationSettings(settings.server), key)

const policyValue = (settings: Record<string, unknown>, key: string): unknown =>
  Object.prototype.hasOwnProperty.call(settings, key)
    ? settings[key]
    : parseModerationSettings(settings.server)[key]

export const isChannelRuleEligible = (settings: unknown, channelUniqueName: string): boolean => {
  const parsed = parseModerationSettings(settings)
  const mode = policyValue(parsed, 'channelRuleEligibility')
  if (!hasPolicyValue(parsed, 'channelRuleEligibility')) return true // Legacy installs retain owner opt-in.
  if (mode === 'all') return true
  if (mode !== 'allowlist') return false
  const allowlist = policyValue(parsed, 'channelRuleAllowlist')
  return Array.isArray(allowlist) &&
    allowlist.every(name => typeof name === 'string') &&
    allowlist.map(name => name.trim()).filter(Boolean).includes(channelUniqueName)
}

export const getServerModerationSettings = (
  pluginVersionsMap: Map<string, Array<{ version: string; edgeData: PluginEdgeData }>>,
  _serverPipeline?: EventPipeline,
): unknown => {
  return getPluginForStep(pluginVersionsMap, MODERATION_PLUGIN_ID)?.edgeData.properties.settingsJson
}

const hasExplicitModerationPolicy = (settings: unknown): boolean => {
  const parsed = parseModerationSettings(settings)
  return ['serverRuleEnforcement', 'channelRuleEligibility', 'channelRuleAllowlist']
    .some(key => hasPolicyValue(parsed, key))
}

export const getModerationOwnerStateVersionId = (
  pluginVersionsMap: Map<string, Array<{ version: string; edgeData: PluginEdgeData }>>,
  executionVersionId: string,
): string => {
  const authority = getPluginForStep(pluginVersionsMap, MODERATION_PLUGIN_ID)
  return authority && hasExplicitModerationPolicy(authority.edgeData.properties.settingsJson)
    ? authority.edgeData.node.id
    : executionVersionId
}

export const supportsModerationPolicy = (version: string, settings: unknown): boolean => {
  return !hasExplicitModerationPolicy(settings) || (/^\d+\.\d+\.\d+$/.test(version) && compareVersions(version, '0.8.0') >= 0)
}

/** Resolve mandatory moderation from server configuration, never channel pins. */
export const protectServerModerationStep = ({
  pluginsToRun, pluginVersionsMap, serverPipeline, event,
}: {
  pluginsToRun: PluginToRun[]
  pluginVersionsMap: Map<string, Array<{ version: string; edgeData: PluginEdgeData }>>
  serverPipeline: EventPipeline | undefined
  event: string
}): PluginToRun[] => {
  const serverStep = serverPipeline?.steps.find(step => step.pluginId === MODERATION_PLUGIN_ID)
  const settings = parseModerationSettings(getServerModerationSettings(pluginVersionsMap))
  const compatible = pluginVersionsMap.get(MODERATION_PLUGIN_ID)?.find(candidate => supportsModerationPolicy(candidate.version, settings))
  pluginsToRun = pluginsToRun.flatMap(plugin => {
    if (plugin.pluginId !== MODERATION_PLUGIN_ID || supportsModerationPolicy(plugin.edgeData.node.version, settings)) return [plugin]
    return compatible ? [{ ...plugin, edgeData: compatible.edgeData, step: { ...plugin.step, version: compatible.version } }] : []
  }).map((plugin, order) => ({ ...plugin, order }))
  let match = getPluginForStep(pluginVersionsMap, MODERATION_PLUGIN_ID, serverStep?.version)
  if (match && !supportsModerationPolicy(match.version, settings)) match = compatible ?? null
  if (!match && policyValue(settings, 'serverRuleEnforcement') === 'on') match = compatible ?? null
  if (!match) return pluginsToRun
  if (policyValue(settings, 'serverRuleEnforcement') !== 'on') return pluginsToRun
  const events = parseManifest(match.edgeData.node.manifest).events
  if (!Array.isArray(events) || !events.includes(event)) return pluginsToRun
  // Run first and unconditionally: a channel-owned prior failure/condition must
  // not suppress server enforcement. One invocation handles both rule scopes.
  return [{
    pluginId: MODERATION_PLUGIN_ID,
    edgeData: match.edgeData,
    step: { ...serverStep, pluginId: MODERATION_PLUGIN_ID, version: match.version, condition: 'ALWAYS' as const },
    order: 0,
  }, ...pluginsToRun.filter(plugin => plugin.pluginId !== MODERATION_PLUGIN_ID)]
    .map((plugin, order) => ({ ...plugin, order }))
}

/** New governance is installation-wide even when execution uses a server pin. */
export const applyServerModerationPolicy = (runtimeSettings: unknown, authoritativeSettings: unknown): Record<string, unknown> => {
  const runtime = { ...parseModerationSettings(runtimeSettings) }
  const authority = parseModerationSettings(authoritativeSettings)
  const nested = runtime.server && typeof runtime.server === 'object' && !Array.isArray(runtime.server)
    ? { ...parseModerationSettings(runtime.server) }
    : null
  if (nested) runtime.server = nested
  for (const key of ['serverRuleEnforcement', 'channelRuleEligibility', 'channelRuleAllowlist']) {
    delete runtime[key]
    if (nested) delete nested[key]
    if (hasPolicyValue(authority, key)) runtime[key] = policyValue(authority, key)
  }
  return runtime
}
