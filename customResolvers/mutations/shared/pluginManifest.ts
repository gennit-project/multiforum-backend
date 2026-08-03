import { Storage } from '@google-cloud/storage'
import path from 'path'
import tar from 'tar-stream'
import zlib from 'zlib'
import { logger } from "../../../logger.js";

type ManifestData = {
  id: string
  version: string
  entry?: string
  documentation?: { readmePath?: string }
  [key: string]: unknown
}

type ManifestSecret = {
  key?: string
  scope?: string
  [key: string]: unknown
}

type ManifestField = {
  key?: string
  [key: string]: unknown
}

type ManifestSection = {
  fields?: ManifestField[]
  [key: string]: unknown
}

export type ManifestArtifacts = {
  id: string
  version: string
  entryPath: string
  manifest: ManifestData
  readmePath?: string
  readmeMarkdown?: string
}

export type DuplicateManifestSecretDiagnostic = {
  pluginId: string
  version: string
  scope: 'server' | 'channel'
  duplicateKeys: string[]
}

const normalizeTarPath = (input: string) => {
  if (!input) return ''
  const stripped = input.replace(/^\.\/+/, '')
  return path.posix.normalize(stripped)
}

const findBestReadme = (entries: Map<string, string>, declaredPath: string | undefined, manifestEntryKey: string) => {
  if (!declaredPath) {
    return { path: undefined, markdown: undefined }
  }

  const normalizedDeclared = normalizeTarPath(declaredPath)
  const manifestDir = manifestEntryKey.includes('/')
    ? manifestEntryKey.slice(0, manifestEntryKey.lastIndexOf('/'))
    : ''

  const candidatePaths = [
    path.posix.join(manifestDir, normalizedDeclared),
    normalizedDeclared,
    path.posix.basename(normalizedDeclared)
  ]

  for (const candidate of candidatePaths) {
    const normalizedCandidate = normalizeTarPath(candidate)
    for (const [entryKey, content] of entries.entries()) {
      if (normalizeTarPath(entryKey) === normalizedCandidate) {
        return { path: candidate, markdown: content }
      }
    }
  }

  return { path: undefined, markdown: undefined }
}

const collectFormFieldKeys = (manifest: ManifestData, scope: 'server' | 'channel') => {
  const ui = manifest.ui as { forms?: { server?: ManifestSection[]; channel?: ManifestSection[] } } | undefined
  const sections = ui?.forms?.[scope]
  if (!Array.isArray(sections)) {
    return []
  }

  const keys = new Set<string>()
  for (const section of sections) {
    if (!section || !Array.isArray(section.fields)) {
      continue
    }

    for (const field of section.fields) {
      if (field && typeof field.key === 'string' && field.key.trim().length > 0) {
        keys.add(field.key)
      }
    }
  }

  return Array.from(keys)
}

export const findDuplicateManifestSecretDiagnostics = (manifest: ManifestData): DuplicateManifestSecretDiagnostic[] => {
  const pluginId = manifest.id || 'unknown-plugin'
  const version = manifest.version || 'unknown-version'
  const secrets = Array.isArray(manifest.secrets) ? manifest.secrets as ManifestSecret[] : []

  return (['server', 'channel'] as const)
    .map((scope) => {
      const secretKeys = new Set(
        secrets
          .filter((secret) => secret && secret.scope === scope && typeof secret.key === 'string' && secret.key.trim().length > 0)
          .map((secret) => secret.key as string)
      )
      const formKeys = collectFormFieldKeys(manifest, scope)
      const duplicateKeys = formKeys.filter((key) => secretKeys.has(key)).sort()

      if (duplicateKeys.length === 0) {
        return null
      }

      return {
        pluginId,
        version,
        scope,
        duplicateKeys,
      }
    })
    .filter((diagnostic): diagnostic is DuplicateManifestSecretDiagnostic => diagnostic !== null)
}

export const formatDuplicateManifestSecretDiagnostic = (
  diagnostic: DuplicateManifestSecretDiagnostic
) => {
  return `Plugin manifest validation failed for ${diagnostic.pluginId}@${diagnostic.version}: duplicate ${diagnostic.scope} secret declarations in secrets[] and ui.forms.${diagnostic.scope} for keys: ${diagnostic.duplicateKeys.join(', ')}`
}

const assertNoDuplicateSecretDeclarations = (manifest: ManifestData) => {
  const diagnostics = findDuplicateManifestSecretDiagnostics(manifest)
  if (diagnostics.length === 0) {
    return
  }

  throw new Error(diagnostics.map(formatDuplicateManifestSecretDiagnostic).join('; '))
}

export async function parseManifestFromTarball(tarballBytes: Buffer): Promise<ManifestArtifacts> {
  return new Promise<ManifestArtifacts>((resolve, reject) => {
    const extract = tar.extract()
    const gunzip = zlib.createGunzip()
    const textEntries = new Map<string, string>()

    extract.on('entry', (header, stream, next) => {
      const normalizedName = normalizeTarPath(header.name)
      const lowerName = normalizedName.toLowerCase()
      const shouldBuffer = lowerName.endsWith('plugin.json') || lowerName.endsWith('.md')

      if (!shouldBuffer) {
        stream.on('end', next)
        stream.resume()
        return
      }

      const chunks: Buffer[] = []
      stream.on('data', chunk => chunks.push(chunk as Buffer))
      stream.on('end', () => {
        const content = Buffer.concat(chunks).toString('utf8')
        textEntries.set(normalizedName, content)
        next()
      })
      stream.on('error', reject)
    })

    extract.on('finish', () => {
      const manifestEntry = Array.from(textEntries.entries()).find(([key]) => key.endsWith('plugin.json'))

      if (!manifestEntry) {
        return reject(new Error('Tarball missing plugin.json'))
      }

      let manifestData: ManifestData
      try {
        manifestData = JSON.parse(manifestEntry[1])
      } catch (error) {
        return reject(new Error(`Invalid plugin.json: ${error instanceof Error ? error.message : String(error)}`))
      }

      try {
        assertNoDuplicateSecretDeclarations(manifestData)
      } catch (error) {
        return reject(error)
      }

      const { path: readmePath, markdown: readmeMarkdown } = findBestReadme(
        textEntries,
        manifestData?.documentation?.readmePath,
        manifestEntry[0]
      )

      resolve({
        id: manifestData.id,
        version: manifestData.version,
        entryPath: manifestData.entry || 'index.js',
        manifest: manifestData,
        readmePath: readmePath || manifestData?.documentation?.readmePath,
        readmeMarkdown
      })
    })

    extract.on('error', reject)
    gunzip.on('error', reject)

    gunzip.pipe(extract)
    gunzip.write(tarballBytes)
    gunzip.end()
  })
}

export async function getManifestArtifacts(tarballUrl: string): Promise<ManifestArtifacts> {
  logger.info(`Downloading and parsing manifest from: ${tarballUrl}`)

  let tarballBytes: Buffer
  if (tarballUrl.startsWith('gs://')) {
    const storage = new Storage()
    const gsPath = tarballUrl.replace('gs://', '')
    const [bucketName, ...pathParts] = gsPath.split('/')
    const filePath = pathParts.join('/')

    const bucket = storage.bucket(bucketName)
    const file = bucket.file(filePath)

    const [contents] = await file.download()
    tarballBytes = contents
  } else {
    const response = await fetch(tarballUrl)
    if (!response.ok) {
      throw new Error(`Failed to download tarball: HTTP ${response.status}`)
    }
    tarballBytes = Buffer.from(await response.arrayBuffer())
  }

  return parseManifestFromTarball(tarballBytes)
}
