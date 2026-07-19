import {
  validatePluginSetting,
  type PluginConfigScope,
  type PluginManifestField
} from './configStatus.js'

export type SettingsCarryOverReport = {
  carried: string[]
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

export const reconcileSettings = (params: {
  oldSettings: unknown
  newManifest: unknown
  scope: PluginConfigScope
}): ReconciledSettings => {
  const manifest = parseRecord(params.newManifest)
  const defaults = parseRecord(asRecord(manifest.settingsDefaults)[params.scope])
  const oldSettings = parseRecord(params.oldSettings)
  const fields = getFields(manifest, params.scope)
  const fieldsByKey = new Map(fields.map(field => [String(field.key), field]))
  const settings: Record<string, unknown> = { ...defaults }
  const carried: string[] = []
  const dropped: string[] = []
  const reset: string[] = []

  for (const [key, value] of Object.entries(oldSettings)) {
    const field = fieldsByKey.get(key)
    if (!field) {
      dropped.push(key)
      continue
    }
    if (validatePluginSetting({ ...field, required: false, validation: { ...field.validation, required: false } }, value)) {
      reset.push(key)
      continue
    }
    settings[key] = value
    carried.push(key)
  }

  const newDefaults = Object.keys(defaults).filter(
    key => !Object.prototype.hasOwnProperty.call(oldSettings, key)
  )
  return {
    settings,
    report: { carried, dropped, reset, newDefaults }
  }
}
