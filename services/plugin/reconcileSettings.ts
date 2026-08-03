import {
  validatePluginSetting,
  type PluginConfigScope,
  type PluginManifestField
} from './configStatus.js'

export type SettingsCarryOverReport = {
  carried: string[]
  renamed: Array<{ from: string; to: string }>
  renamedSecrets: Array<{ from: string; to: string }>
  dropped: string[]
  reset: string[]
  newDefaults: string[]
}

export type ReconciledSettings = {
  settings: Record<string, unknown>
  report: SettingsCarryOverReport
}

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

const parseRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'string') return asRecord(value)
  try {
    return asRecord(JSON.parse(value))
  } catch {
    return {}
  }
}

const getFields = (manifest: Record<string, unknown>, scope: PluginConfigScope): PluginManifestField[] => {
  const ui = asRecord(manifest.ui)
  const forms = asRecord(ui.forms)
  const sections = forms[scope]
  if (!Array.isArray(sections)) return []
  return sections.flatMap(section => {
    const fields = asRecord(section).fields
    return Array.isArray(fields) ? fields as PluginManifestField[] : []
  }).filter(field => typeof field.key === 'string' && field.type !== 'secret')
}

const hasOwn = (record: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(record, key)

const getRenameMap = (params: {
  newFields: PluginManifestField[]
  oldFields: PluginManifestField[]
  oldSettings: Record<string, unknown>
  defaults: Record<string, unknown>
}): Map<string, string> => {
  const newKeys = new Set<string>()
  const sourceToTarget = new Map<string, string>()
  const renames = new Map<string, string>()

  for (const field of params.newFields) {
    const target = String(field.key)
    if (newKeys.has(target)) {
      throw new Error(`Ambiguous setting definition for key "${target}"`)
    }
    newKeys.add(target)

    if (field.renamedFrom === undefined) continue
    if (typeof field.renamedFrom !== 'string' || !field.renamedFrom.trim()) {
      throw new Error(`Setting "${target}" has an invalid renamedFrom value`)
    }
    const source = field.renamedFrom
    if (source === target) {
      throw new Error(`Setting "${target}" cannot be renamed from itself`)
    }
    const existingTarget = sourceToTarget.get(source)
    if (existingTarget) {
      throw new Error(`Ambiguous setting rename from "${source}" to both "${existingTarget}" and "${target}"`)
    }
    sourceToTarget.set(source, target)
    renames.set(target, source)
  }

  for (const [target, source] of renames) {
    if (renames.has(source)) {
      throw new Error(`Setting rename chains are not supported: "${source}" to "${target}"`)
    }
    const oldSource = params.oldFields.find(field => field.key === source)
    if (typeof oldSource?.renamedFrom === 'string') {
      throw new Error(`Setting rename chains are not supported for "${target}"`)
    }
    if (newKeys.has(source) || hasOwn(params.defaults, source)) {
      throw new Error(`Setting rename collision: source "${source}" is still declared by the new manifest`)
    }
    if (hasOwn(params.oldSettings, source) && hasOwn(params.oldSettings, target)) {
      throw new Error(`Setting rename collision: both "${source}" and "${target}" have stored values`)
    }
  }

  return renames
}

const validateCarriedValue = (
  field: PluginManifestField | undefined,
  defaultValue: unknown,
  value: unknown
) => {
  const hasCompatibleDefaultType =
    defaultValue === null ||
    (Array.isArray(defaultValue)
      ? Array.isArray(value)
      : typeof defaultValue === typeof value)
  return field
    ? validatePluginSetting({ ...field, required: false, validation: { ...field.validation, required: false } }, value)
    : (hasCompatibleDefaultType ? null : 'Value has an incompatible type')
}

export const reconcileSettings = (params: {
  oldSettings: unknown
  oldManifest?: unknown
  newManifest: unknown
  scope: PluginConfigScope
}): ReconciledSettings => {
  const manifest = parseRecord(params.newManifest)
  const defaults = parseRecord(asRecord(manifest.settingsDefaults)[params.scope])
  const oldSettings = parseRecord(params.oldSettings)
  const fields = getFields(manifest, params.scope)
  const oldFields = getFields(parseRecord(params.oldManifest), params.scope)
  const fieldsByKey = new Map(fields.map(field => [String(field.key), field]))
  const renames = getRenameMap({ newFields: fields, oldFields, oldSettings, defaults })
  const settings: Record<string, unknown> = { ...defaults }
  const carried: string[] = []
  const renamed: Array<{ from: string; to: string }> = []
  const dropped: string[] = []
  const reset: string[] = []

  const consumedSources = new Set<string>()
  for (const [target, source] of renames) {
    if (!hasOwn(oldSettings, source)) continue
    consumedSources.add(source)
    const error = validateCarriedValue(fieldsByKey.get(target), defaults[target], oldSettings[source])
    if (error) {
      reset.push(target)
      continue
    }
    settings[target] = oldSettings[source]
    renamed.push({ from: source, to: target })
  }

  for (const [key, value] of Object.entries(oldSettings)) {
    if (consumedSources.has(key)) continue
    const field = fieldsByKey.get(key)
    const hasDefault = hasOwn(defaults, key)
    if (!field && !hasDefault) {
      dropped.push(key)
      continue
    }
    if (validateCarriedValue(field, defaults[key], value)) {
      reset.push(key)
      continue
    }
    settings[key] = value
    carried.push(key)
  }

  const newDefaults = Object.keys(defaults).filter(
    key => !hasOwn(oldSettings, key) && !hasOwn(oldSettings, renames.get(key) || '')
  )
  return {
    settings,
    report: { carried, renamed, renamedSecrets: [], dropped, reset, newDefaults }
  }
}
