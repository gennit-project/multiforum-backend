import { Storage } from '@google-cloud/storage'
import path from 'path'
import tar from 'tar-stream'
import zlib from 'zlib'

export type ManifestArtifacts = {
  id: string
  version: string
  entryPath: string
  manifest: any
  readmePath?: string
  readmeMarkdown?: string
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

      let manifestData: any
      try {
        manifestData = JSON.parse(manifestEntry[1])
      } catch (error) {
        return reject(new Error(`Invalid plugin.json: ${(error as any).message}`))
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
  console.log(`Downloading and parsing manifest from: ${tarballUrl}`)

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
