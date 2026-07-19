export type PluginConfigScope = 'server' | 'channel'

export type SecretValidationStatus =
  | 'NOT_SET'
  | 'SET_UNTESTED'
  | 'VALID'
  | 'INVALID'

export type PluginConfigFieldStatus = {
  key: string
  label: string
  scope: PluginConfigScope
  kind: 'SETTING' | 'SECRET'
  required: boolean
  isSet: boolean
  isValid: boolean
  message: string | null
}

export type PluginConfigStatus = {
  isFullyConfigured: boolean
  fields: PluginConfigFieldStatus[]
}

type ManifestField = {
  key?: unknown
  label?: unknown
  type?: unknown
  required?: unknown
  options?: Array<{ value?: unknown }>
  validation?: {
    required?: unknown
    min?: unknown
    max?: unknown
    minLength?: unknown
    maxLength?: unknown
    pattern?: unknown
  }
}

type ManifestSecret = {
  key?: unknown
  label?: unknown
  scope?: unknown
  required?: unknown
}

type Manifest = {
  secrets?: unknown
  settingsDefaults?: unknown
  ui?: {
    forms?: Partial<Record<PluginConfigScope, unknown>>
  }
}

export type SecretStatusRecord = {
  key: string
  status: SecretValidationStatus
}

export const resolveSecretValidationStatus = (secret: {
  isValid?: boolean | null
  lastValidatedAt?: unknown
  validationError?: string | null
}): SecretValidationStatus => {
  if (!secret.lastValidatedAt) return 'SET_UNTESTED'
  return secret.isValid === true && !secret.validationError ? 'VALID' : 'INVALID'
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

const isMateriallyPresent = (value: unknown): boolean => {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim().length > 0
  return true
}

const validateSetting = (field: ManifestField, value: unknown): string | null => {
  const required = field.required === true || field.validation?.required === true
  if (!isMateriallyPresent(value)) {
    return required ? 'Required setting is not set' : null
  }

  if (field.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
    return 'Value must be a number'
  }
  if ((field.type === 'boolean' || field.type === 'toggle') && typeof value !== 'boolean') {
    return 'Value must be a boolean'
  }
  if (
    ['text', 'textarea'].includes(String(field.type)) &&
    typeof value !== 'string'
  ) {
    return 'Value must be text'
  }

  const allowedValues = Array.isArray(field.options)
    ? field.options.map(option => option.value)
    : []
  if (field.type === 'select' && !allowedValues.some(option => Object.is(option, value))) {
    return 'Value is not an allowed option'
  }

  const validation = field.validation || {}
  if (typeof value === 'number') {
    if (typeof validation.min === 'number' && value < validation.min) return `Value must be at least ${validation.min}`
    if (typeof validation.max === 'number' && value > validation.max) return `Value must be at most ${validation.max}`
  }
  if (typeof value === 'string') {
    if (typeof validation.minLength === 'number' && value.length < validation.minLength) return `Value must contain at least ${validation.minLength} characters`
    if (typeof validation.maxLength === 'number' && value.length > validation.maxLength) return `Value must contain at most ${validation.maxLength} characters`
    if (typeof validation.pattern === 'string') {
      try {
        if (!new RegExp(validation.pattern).test(value)) return 'Value has an invalid format'
      } catch {
        return 'Setting has an invalid validation pattern'
      }
    }
  }

  return null
}

export const buildPluginConfigStatus = (params: {
  manifest: unknown
  settingsJson: unknown
  secretStatuses?: SecretStatusRecord[]
  scope: PluginConfigScope
}): PluginConfigStatus => {
  const manifest = parseRecord(params.manifest) as Manifest
  const defaults = parseRecord(asRecord(manifest.settingsDefaults)[params.scope])
  const savedSettings = parseRecord(params.settingsJson)
  const settings = { ...defaults, ...savedSettings }
  const secretStatuses = new Map(
    (params.secretStatuses || []).map(secret => [secret.key, secret.status])
  )

  const declaredSecrets = Array.isArray(manifest.secrets)
    ? (manifest.secrets as ManifestSecret[]).filter(secret =>
        secret &&
        typeof secret.key === 'string' &&
        (secret.scope === params.scope || secret.scope === undefined)
      )
    : []
  const declaredSecretKeys = new Set(declaredSecrets.map(secret => String(secret.key)))

  const sections = manifest.ui?.forms?.[params.scope]
  const formFields = Array.isArray(sections)
    ? sections.flatMap(section => {
        const fields = asRecord(section).fields
        return Array.isArray(fields) ? fields as ManifestField[] : []
      })
    : []

  const settingFields: PluginConfigFieldStatus[] = formFields
    .filter(field =>
      typeof field?.key === 'string' &&
      field.type !== 'secret' &&
      !declaredSecretKeys.has(field.key)
    )
    .map(field => {
      const key = String(field.key)
      const value = settings[key]
      const message = validateSetting(field, value)
      return {
        key,
        label: typeof field.label === 'string' ? field.label : key,
        scope: params.scope,
        kind: 'SETTING' as const,
        required: field.required === true || field.validation?.required === true,
        isSet: isMateriallyPresent(value),
        isValid: message === null,
        message
      }
    })

  const secretFields: PluginConfigFieldStatus[] = declaredSecrets.map(secret => {
    const key = String(secret.key)
    const status = secretStatuses.get(key) || 'NOT_SET'
    const isSet = status !== 'NOT_SET'
    const isValid = status === 'VALID' || status === 'SET_UNTESTED'
    return {
      key,
      label: typeof secret.label === 'string' ? secret.label : key,
      scope: params.scope,
      kind: 'SECRET' as const,
      required: secret.required !== false,
      isSet,
      isValid,
      message: isValid ? null : (isSet ? 'Secret is invalid' : 'Required secret is not set')
    }
  })

  const fields = [...settingFields, ...secretFields]
  return {
    fields,
    isFullyConfigured: fields.every(field => !field.required || (field.isSet && field.isValid))
  }
}

export const getBlockingConfigFields = (
  status: PluginConfigStatus
): PluginConfigFieldStatus[] => status.fields.filter(
  field => field.required && (!field.isSet || !field.isValid)
)
