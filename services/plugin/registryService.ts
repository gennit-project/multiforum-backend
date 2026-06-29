import { Storage } from '@google-cloud/storage'

export type RegistryVersion = {
  version: string
  tarballUrl: string
  integritySha256: string
  registryUrl?: string
  releaseNotesUrl?: string
  sourceRepoUrl?: string
  sourceCommit?: string
  minServerVersion?: string
  apiVersion?: string
}

export type RegistryPlugin = {
  id: string
  versions: RegistryVersion[]
}

export type PluginRegistry = {
  updatedAt?: string
  plugins: RegistryPlugin[]
}

const storage = new Storage()

export async function fetchJsonFromUrl<T>(url: string): Promise<T> {
  if (url.startsWith('gs://')) {
    const gsPath = url.replace('gs://', '')
    const [bucketName, ...pathParts] = gsPath.split('/')
    const filePath = pathParts.join('/')

    const bucket = storage.bucket(bucketName)
    const file = bucket.file(filePath)
    const [contents] = await file.download()
    return JSON.parse(contents.toString()) as T
  }

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }
  return await response.json() as T
}

export async function downloadBytes(url: string): Promise<Buffer> {
  if (url.startsWith('gs://')) {
    const gsPath = url.replace('gs://', '')
    const [bucketName, ...pathParts] = gsPath.split('/')
    const filePath = pathParts.join('/')

    const bucket = storage.bucket(bucketName)
    const file = bucket.file(filePath)
    const [contents] = await file.download()
    return contents
  }

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download tarball: HTTP ${response.status}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

export function compareVersions(a: string, b: string): number {
  const normalize = (version: string) => version.replace(/^v/i, '')
  const parse = (version: string) => {
    const [core, prerelease] = normalize(version).split('-', 2)
    const parts = core.split('.').map((part) => {
      const parsed = Number.parseInt(part, 10)
      return Number.isFinite(parsed) ? parsed : 0
    })
    while (parts.length < 3) parts.push(0)
    return { parts, prerelease: prerelease || '' }
  }

  const parsedA = parse(a)
  const parsedB = parse(b)

  for (let i = 0; i < Math.max(parsedA.parts.length, parsedB.parts.length); i += 1) {
    const aPart = parsedA.parts[i] || 0
    const bPart = parsedB.parts[i] || 0
    if (aPart !== bPart) return aPart - bPart
  }

  if (parsedA.prerelease && !parsedB.prerelease) return -1
  if (!parsedA.prerelease && parsedB.prerelease) return 1
  return parsedA.prerelease.localeCompare(parsedB.prerelease)
}

export function sortVersionsDescending<T extends { version: string }>(versions: T[]): T[] {
  return [...versions].sort((a, b) => compareVersions(b.version, a.version))
}

export function findLatestVersion(versions: string[]): string | null {
  if (!versions.length) return null
  return sortVersionsDescending(versions.map((version) => ({ version })))[0]?.version ?? null
}

export async function fetchMergedPluginRegistry(registryUrls: string[]): Promise<PluginRegistry> {
  const trimmedRegistryUrls = registryUrls.map((url) => url.trim()).filter(Boolean)
  if (!trimmedRegistryUrls.length) {
    throw new Error('No plugin registries configured')
  }

  const mergedPlugins = new Map<string, RegistryPlugin>()

  for (const registryUrl of trimmedRegistryUrls) {
    let registry: PluginRegistry
    try {
      registry = await fetchJsonFromUrl<PluginRegistry>(registryUrl)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to fetch plugin registry ${registryUrl}: ${message}`)
    }

    for (const plugin of registry.plugins || []) {
      if (!plugin?.id) continue
      const current = mergedPlugins.get(plugin.id) || { id: plugin.id, versions: [] }
      const versionsByNumber = new Map(current.versions.map((version) => [version.version, version]))

      for (const version of plugin.versions || []) {
        if (!version?.version || !version.tarballUrl || !version.integritySha256) continue
        const normalizedVersion = { ...version, registryUrl }
        const existing = versionsByNumber.get(version.version)

        if (existing && (
          existing.tarballUrl !== version.tarballUrl ||
          existing.integritySha256 !== version.integritySha256
        )) {
          throw new Error(
            `Conflicting registry entry for ${plugin.id}@${version.version} between ${existing.registryUrl || 'unknown registry'} and ${registryUrl}`
          )
        }

        versionsByNumber.set(version.version, normalizedVersion)
      }

      current.versions = sortVersionsDescending(Array.from(versionsByNumber.values()))
      mergedPlugins.set(plugin.id, current)
    }
  }

  return {
    updatedAt: new Date().toISOString(),
    plugins: Array.from(mergedPlugins.values()).sort((a, b) => a.id.localeCompare(b.id))
  }
}
