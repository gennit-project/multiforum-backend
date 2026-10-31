import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const TOKENS = {
  scanServiceUrl: '__SCAN_SERVICE_URL__',
  moderationServiceUrl: '__LLM_MODERATION_SERVICE_URL__',
  trialForum: '__LLM_MODERATION_TRIAL_FORUM__',
} as const

export type ProductionPluginConfigurationValues = {
  scanServiceUrl: string
  moderationServiceUrl: string
  trialForum: string
}

const normalizeHttpsOrigin = (name: string, value: string): string => {
  const url = new URL(value.trim())
  if (
    url.protocol !== 'https:' || url.username || url.password ||
    url.pathname !== '/' || url.search || url.hash
  ) {
    throw new Error(`${name} must be an HTTPS origin without credentials, path, query, or fragment`)
  }
  return url.origin
}

const normalizeTrialForum = (value: string): string => {
  const normalized = value.trim()
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new Error('trialForum must be a non-empty channel unique name')
  }
  return normalized
}

const replaceTokens = (
  value: unknown,
  replacements: ReadonlyMap<string, string>
): unknown => {
  if (Array.isArray(value)) {
    return value.map(entry => replaceTokens(entry, replacements))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, replaceTokens(entry, replacements)])
    )
  }
  return typeof value === 'string' ? replacements.get(value) ?? value : value
}

export const renderProductionPluginConfiguration = (
  template: unknown,
  values: ProductionPluginConfigurationValues
): Record<string, unknown> => {
  const replacements = new Map([
    [TOKENS.scanServiceUrl, normalizeHttpsOrigin('scanServiceUrl', values.scanServiceUrl)],
    [TOKENS.moderationServiceUrl, normalizeHttpsOrigin('moderationServiceUrl', values.moderationServiceUrl)],
    [TOKENS.trialForum, normalizeTrialForum(values.trialForum)],
  ])
  const rendered = replaceTokens(template, replacements)
  if (!rendered || typeof rendered !== 'object' || Array.isArray(rendered)) {
    throw new Error('Production plugin configuration template must contain an object')
  }
  const serialized = JSON.stringify(rendered)
  if (serialized.includes('__')) {
    throw new Error('Production plugin configuration contains an unresolved template token')
  }
  return rendered as Record<string, unknown>
}

const argument = (args: string[], name: string): string => {
  const index = args.indexOf(name)
  const value = index >= 0 ? args[index + 1] : undefined
  if (!value) throw new Error(`Missing required argument: ${name}`)
  return value
}

export const main = async (args = process.argv.slice(2)): Promise<void> => {
  const templatePath = resolve(argument(args, '--template'))
  const outputPath = resolve(argument(args, '--output'))
  const template = JSON.parse(await readFile(templatePath, 'utf8')) as unknown
  const rendered = renderProductionPluginConfiguration(template, {
    scanServiceUrl: argument(args, '--scan-service-url'),
    moderationServiceUrl: argument(args, '--moderation-service-url'),
    trialForum: argument(args, '--trial-forum'),
  })
  await writeFile(outputPath, `${JSON.stringify(rendered, null, 2)}\n`, 'utf8')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
