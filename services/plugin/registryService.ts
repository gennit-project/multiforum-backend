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

type GitHubReleaseAsset = {
  name?: string
  browser_download_url?: string
}

type GitHubRelease = {
  tag_name?: string
  html_url?: string
  target_commitish?: string
  assets?: GitHubReleaseAsset[]
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

const isGitHubRepoUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url)
    if (parsed.hostname !== 'github.com') return false
    const parts = parsed.pathname.split('/').filter(Boolean)
    return parts.length >= 2 && !parts[0].startsWith('.')
  } catch {
    return false
  }
}

const normalizeGitHubRepoUrl = (url: string): string => {
  const parsed = new URL(url)
  const parts = parsed.pathname.split('/').filter(Boolean)
  const owner = parts[0]
  const repo = parts[1].replace(/\.git$/, '')
  return `https://github.com/${owner}/${repo}`
}

const githubApiHeaders = (): HeadersInit => {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  return token
    ? {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28'
      }
    : {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28'
      }
}

const fetchGitHubJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url, { headers: githubApiHeaders() })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }
  return await response.json() as T
}

const fetchGitHubText = async (url: string): Promise<string> => {
  const response = await fetch(url, { headers: githubApiHeaders() })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }
  return await response.text()
}

const githubReleaseRegistryFromRepoUrl = async (repoUrl: string): Promise<PluginRegistry> => {
  const normalizedRepoUrl = normalizeGitHubRepoUrl(repoUrl)
  const parsed = new URL(normalizedRepoUrl)
  const [owner, repo] = parsed.pathname.split('/').filter(Boolean)
  const releasesUrl = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=100`
  const releases = await fetchGitHubJson<GitHubRelease[]>(releasesUrl)

  const pluginVersionsById = new Map<string, RegistryVersion[]>()

  for (const release of releases || []) {
    const assets = release.assets || []
    const manifestAsset = assets.find((asset) => asset.name === 'plugin.json' && asset.browser_download_url)
    const tarballAsset = assets.find((asset) => asset.name?.endsWith('.tgz') && asset.browser_download_url)
    const checksumAsset = assets.find((asset) => asset.name?.endsWith('.tgz.sha256') && asset.browser_download_url)

    if (!manifestAsset?.browser_download_url || !tarballAsset?.browser_download_url || !checksumAsset?.browser_download_url) {
      continue
    }

    const manifest = JSON.parse(await fetchGitHubText(manifestAsset.browser_download_url)) as {
      id?: string
      version?: string
      source?: {
        repoUrl?: string
        releaseNotesUrl?: string
        commit?: string
      }
      compatibility?: {
        minServerVersion?: string
        apiVersion?: string
      }
    }

    if (!manifest.id || !manifest.version) {
      continue
    }

    const integritySha256 = (await fetchGitHubText(checksumAsset.browser_download_url)).split(/\s+/)[0]?.trim()
    if (!integritySha256) {
      continue
    }

    const version: RegistryVersion = {
      version: manifest.version,
      tarballUrl: tarballAsset.browser_download_url,
      integritySha256,
      registryUrl: normalizedRepoUrl,
      releaseNotesUrl: release.html_url || manifest.source?.releaseNotesUrl || `${normalizedRepoUrl}/releases/tag/v${manifest.version}`,
      sourceRepoUrl: manifest.source?.repoUrl || normalizedRepoUrl,
      sourceCommit: manifest.source?.commit || release.target_commitish || '',
      minServerVersion: manifest.compatibility?.minServerVersion || '',
      apiVersion: manifest.compatibility?.apiVersion || ''
    }

    const versions = pluginVersionsById.get(manifest.id) || []
    versions.push(version)
    pluginVersionsById.set(manifest.id, versions)
  }

  return {
    updatedAt: new Date().toISOString(),
    plugins: Array.from(pluginVersionsById.entries())
      .map(([id, versions]) => ({
        id,
        versions: sortVersionsDescending(versions)
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
  }
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
      if (isGitHubRepoUrl(registryUrl)) {
        registry = await githubReleaseRegistryFromRepoUrl(registryUrl)
      } else {
        registry = await fetchJsonFromUrl<PluginRegistry>(registryUrl)
      }
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
