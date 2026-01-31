import crypto from 'crypto'
import type { PipelineStep, EventPipeline } from './types.js'

export const generatePipelineId = (): string => {
  return `pipeline-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
}

export const shouldRunStep = (
  step: PipelineStep,
  previousStatus: 'SUCCEEDED' | 'FAILED' | null
): boolean => {
  const condition = step.condition || 'ALWAYS'

  if (condition === 'ALWAYS') {
    return true
  }

  if (condition === 'PREVIOUS_SUCCEEDED') {
    return previousStatus === 'SUCCEEDED'
  }

  if (condition === 'PREVIOUS_FAILED') {
    return previousStatus === 'FAILED'
  }

  return true
}

export const mergeSettings = (defaults: any, overrides: any): any => {
  if (overrides === null || overrides === undefined) {
    return defaults
  }

  if (Array.isArray(defaults) && Array.isArray(overrides)) {
    return overrides
  }

  if (typeof defaults === 'object' && defaults !== null && typeof overrides === 'object' && overrides !== null) {
    const output: Record<string, any> = { ...defaults }
    Object.keys(overrides).forEach(key => {
      output[key] = mergeSettings(defaults ? defaults[key] : undefined, overrides[key])
    })
    return output
  }

  return overrides
}

export const getAttachmentUrls = (downloadableFile: any): string[] => {
  const urls: string[] = []
  if (downloadableFile.url) {
    urls.push(downloadableFile.url)
  }
  return urls
}

export const parseStoredPipelines = (stored: any): EventPipeline[] => {
  if (!stored) return []
  if (typeof stored === 'string') {
    try {
      return JSON.parse(stored)
    } catch {
      return []
    }
  }
  return Array.isArray(stored) ? stored : []
}

export const parseManifest = (manifest: any): Record<string, any> => {
  if (!manifest) return {}
  if (typeof manifest === 'string') {
    try {
      return JSON.parse(manifest)
    } catch {
      return {}
    }
  }
  return manifest
}

/**
 * Compare two semantic version strings.
 * Returns: positive if v1 > v2, negative if v1 < v2, 0 if equal
 */
export const compareVersions = (v1: string, v2: string): number => {
  const parts1 = v1.split('.').map(p => parseInt(p, 10) || 0)
  const parts2 = v2.split('.').map(p => parseInt(p, 10) || 0)

  const maxLen = Math.max(parts1.length, parts2.length)
  for (let i = 0; i < maxLen; i++) {
    const p1 = parts1[i] || 0
    const p2 = parts2[i] || 0
    if (p1 !== p2) {
      return p1 - p2
    }
  }
  return 0
}

/**
 * Build a map of enabled plugin versions.
 * Key format: "pluginName" -> array of all enabled versions
 * Returns both the multi-version map and a convenience map for latest versions.
 */
export const buildPluginVersionMaps = (edges: any[]) => {
  // Map of pluginName -> array of {version, edgeData} sorted by version desc
  const pluginVersionsMap = new Map<string, Array<{ version: string; edgeData: any }>>()

  for (const edge of edges) {
    const edgeData = edge as any
    if (edgeData.properties?.enabled && edgeData.node?.Plugin?.name) {
      const pluginName = edgeData.node.Plugin.name
      const version = edgeData.node.version

      if (!pluginVersionsMap.has(pluginName)) {
        pluginVersionsMap.set(pluginName, [])
      }
      pluginVersionsMap.get(pluginName)!.push({ version, edgeData })
    }
  }

  // Sort each plugin's versions in descending order (latest first)
  for (const [, versions] of pluginVersionsMap) {
    versions.sort((a, b) => compareVersions(b.version, a.version))
  }

  return pluginVersionsMap
}

/**
 * Get the appropriate plugin version for a pipeline step.
 * If step specifies a version, use that exact version.
 * Otherwise, use the latest enabled version.
 */
export const getPluginForStep = (
  pluginVersionsMap: Map<string, Array<{ version: string; edgeData: any }>>,
  pluginId: string,
  requestedVersion?: string
): { edgeData: any; version: string } | null => {
  const versions = pluginVersionsMap.get(pluginId)
  if (!versions || versions.length === 0) {
    return null
  }

  if (requestedVersion) {
    // Find exact version match
    const match = versions.find(v => v.version === requestedVersion)
    if (match) {
      return { edgeData: match.edgeData, version: match.version }
    }
    // Requested version not found/enabled
    return null
  }

  // No version specified, use latest (first in sorted array)
  return { edgeData: versions[0].edgeData, version: versions[0].version }
}
