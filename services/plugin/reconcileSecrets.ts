import type { PluginConfigScope } from './configStatus.js'
import type { ServerSecretModel } from '../../ogm_types.js'

type SecretDefinition = {
  key?: unknown
  scope?: unknown
  renamedFrom?: unknown
}

export type SecretRename = { from: string; to: string }

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

const getSecrets = (manifest: unknown, scope: PluginConfigScope): SecretDefinition[] => {
  const secrets = parseRecord(manifest).secrets
  if (!Array.isArray(secrets)) return []
  return (secrets as SecretDefinition[]).filter(secret =>
    typeof secret?.key === 'string' && (secret.scope === undefined || secret.scope === scope)
  )
}

export const planSecretRenames = (params: {
  oldManifest: unknown
  newManifest: unknown
  storedKeys: string[]
  scope: PluginConfigScope
}): SecretRename[] => {
  const oldSecrets = getSecrets(params.oldManifest, params.scope)
  const newSecrets = getSecrets(params.newManifest, params.scope)
  const storedKeys = new Set(params.storedKeys)
  const oldByKey = new Map(oldSecrets.map(secret => [String(secret.key), secret]))
  const targetKeys = new Set<string>()
  const sourceToTarget = new Map<string, string>()
  const declaredRenames = new Map<string, string>()

  for (const secret of newSecrets) {
    const target = String(secret.key)
    if (targetKeys.has(target)) {
      throw new Error(`Ambiguous secret definition for key "${target}"`)
    }
    targetKeys.add(target)
    if (secret.renamedFrom === undefined) continue
    if (typeof secret.renamedFrom !== 'string' || !secret.renamedFrom.trim()) {
      throw new Error(`Secret "${target}" has an invalid renamedFrom value`)
    }
    const source = secret.renamedFrom
    if (source === target) throw new Error(`Secret "${target}" cannot be renamed from itself`)
    const existingTarget = sourceToTarget.get(source)
    if (existingTarget) {
      throw new Error(`Ambiguous secret rename from "${source}" to both "${existingTarget}" and "${target}"`)
    }
    sourceToTarget.set(source, target)
    declaredRenames.set(target, source)
  }

  const planned: SecretRename[] = []
  for (const [target, source] of declaredRenames) {
    if (declaredRenames.has(source) || typeof oldByKey.get(source)?.renamedFrom === 'string') {
      throw new Error(`Secret rename chains are not supported for "${target}"`)
    }
    if (targetKeys.has(source)) {
      throw new Error(`Secret rename collision: source "${source}" is still declared by the new manifest`)
    }
    if (!storedKeys.has(source)) continue
    if (!oldByKey.has(source)) {
      throw new Error(`Secret rename source "${source}" was not declared by the installed version`)
    }
    if (storedKeys.has(target)) {
      throw new Error(`Secret rename collision: both "${source}" and "${target}" are stored`)
    }
    planned.push({ from: source, to: target })
  }
  return planned
}

export const migrateServerSecretRenames = async (params: {
  ServerSecret: ServerSecretModel
  pluginId: string
  oldManifest: unknown
  newManifest: unknown
}): Promise<SecretRename[]> => {
  const secrets = await params.ServerSecret.find({
    where: { pluginId: params.pluginId },
    selectionSet: `{ id key }`
  })
  const records = secrets.filter(secret =>
    typeof secret.id === 'string' && typeof secret.key === 'string'
  )
  const renames = planSecretRenames({
    oldManifest: params.oldManifest,
    newManifest: params.newManifest,
    storedKeys: records.map(secret => secret.key),
    scope: 'server'
  })
  const recordsByKey = new Map(records.map(secret => [secret.key, secret]))
  for (const rename of renames) {
    await params.ServerSecret.update({
      where: { id: recordsByKey.get(rename.from)!.id },
      update: { key: rename.to }
    })
  }
  return renames
}
