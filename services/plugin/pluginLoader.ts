import { Storage } from '@google-cloud/storage'
import os from 'os'
import path from 'path'
import { pathToFileURL } from 'url'
import { promises as fs } from 'fs'
import tar from 'tar-stream'
import zlib from 'zlib'
import { logger } from "../../logger.js";

// Shape of the value a plugin's handleEvent resolves to.
export type PluginRunResult = {
  success?: boolean
  error?: string
  result?: { message?: string } & Record<string, unknown>
} & Record<string, unknown>

// A constructed plugin instance exposes a handleEvent method.
export type PluginInstance = {
  handleEvent: (envelope: unknown) => Promise<PluginRunResult>
}

// A loaded plugin implementation is a constructor invoked as `new PluginClass(context)`.
export type PluginConstructor = new (...args: unknown[]) => PluginInstance

export const pluginModuleCache = new Map<string, PluginConstructor>()
export const tarballCache = new Map<string, Buffer>()

export const downloadTarball = async (tarballUrl: string): Promise<Buffer> => {
  if (tarballCache.has(tarballUrl)) {
    return tarballCache.get(tarballUrl) as Buffer
  }

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

  tarballCache.set(tarballUrl, tarballBytes)
  return tarballBytes
}

export const extractTarballToTempDir = async (tarballBytes: Buffer): Promise<string> => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mf-plugin-'))

  await new Promise<void>((resolve, reject) => {
    const extract = tar.extract()
    extract.on('entry', async (header, stream, next) => {
      const filePath = path.join(tempDir, header.name)
      try {
        if (header.type === 'directory') {
          await fs.mkdir(filePath, { recursive: true })
          stream.resume()
          return next()
        }

        await fs.mkdir(path.dirname(filePath), { recursive: true })
        const chunks: Buffer[] = []
        stream.on('data', chunk => chunks.push(chunk as Buffer))
        stream.on('end', async () => {
          await fs.writeFile(filePath, Buffer.concat(chunks))
          next()
        })
        stream.on('error', reject)
      } catch (error) {
        reject(error)
      }
    })

    extract.on('finish', resolve)
    extract.on('error', reject)

    const gunzip = zlib.createGunzip()
    gunzip.on('error', reject)
    gunzip.pipe(extract)
    gunzip.end(tarballBytes)
  })

  return tempDir
}

export const loadPluginImplementation = async (tarballUrl: string, entryPath: string): Promise<PluginConstructor> => {
  const cacheKey = `${tarballUrl}:${entryPath}`
  if (pluginModuleCache.has(cacheKey)) {
    return pluginModuleCache.get(cacheKey) as PluginConstructor
  }

  const tarballBytes = await downloadTarball(tarballUrl)
  const tempDir = await extractTarballToTempDir(tarballBytes)
  const normalizedEntry = entryPath || 'dist/index.js'
  const absoluteEntryPath = path.join(tempDir, normalizedEntry)

  try {
    const moduleUrl = pathToFileURL(absoluteEntryPath).href
    const importedModule = (await import(moduleUrl)) as Record<string, unknown>

    // Debug: Log what the module exports
    logger.info(`[PluginLoader] Module keys for ${entryPath}:`, Object.keys(importedModule))
    logger.info(`[PluginLoader] Has default export:`, !!importedModule.default)
    logger.info(`[PluginLoader] Default export type:`, typeof importedModule.default)

    // Try to find the plugin class in various export formats
    let PluginClass: unknown = importedModule.default

    // If default is an object (not a function), look inside it for the class
    if (PluginClass && typeof PluginClass === 'object' && typeof PluginClass !== 'function') {
      const defaultObject = PluginClass as Record<string, unknown>
      logger.info(`[PluginLoader] Default is an object with keys:`, Object.keys(defaultObject))

      // Look for common property names that might hold the class
      const possibleNames = ['Plugin', 'default', 'ChatGPTBotProfiles', 'BetaReaderBot']
      for (const name of possibleNames) {
        if (typeof defaultObject[name] === 'function') {
          logger.info(`[PluginLoader] Found plugin class inside default.${name}`)
          PluginClass = defaultObject[name]
          break
        }
      }

      // If still not a function, try the first function property in the default object
      if (typeof PluginClass !== 'function') {
        for (const key of Object.keys(defaultObject)) {
          if (typeof defaultObject[key] === 'function') {
            logger.info(`[PluginLoader] Found plugin class inside default.${key}`)
            PluginClass = defaultObject[key]
            break
          }
        }
      }
    }

    // If default is not usable, check for named exports on the module
    if (typeof PluginClass !== 'function') {
      const possibleNames = ['Plugin', 'ChatGPTBotProfiles', 'BetaReaderBot']
      for (const name of possibleNames) {
        if (typeof importedModule[name] === 'function') {
          PluginClass = importedModule[name]
          logger.info(`[PluginLoader] Found plugin class at named export: ${name}`)
          break
        }
      }

      // If still not found, try the first function export
      if (typeof PluginClass !== 'function') {
        for (const key of Object.keys(importedModule)) {
          if (typeof importedModule[key] === 'function') {
            PluginClass = importedModule[key]
            logger.info(`[PluginLoader] Found plugin class at named export: ${key}`)
            break
          }
        }
      }
    }

    if (typeof PluginClass !== 'function') {
      const defaultExport = importedModule.default
      throw new Error(`Plugin module does not export a constructor. Module exports: ${Object.keys(importedModule).join(', ')}. Default export keys: ${defaultExport ? Object.keys(defaultExport as Record<string, unknown>).join(', ') : 'N/A'}`)
    }

    const resolvedPluginClass = PluginClass as unknown as PluginConstructor
    pluginModuleCache.set(cacheKey, resolvedPluginClass)
    return resolvedPluginClass
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}
