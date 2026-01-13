import { Storage } from '@google-cloud/storage'
import crypto from 'crypto'
import os from 'os'
import path from 'path'
import { pathToFileURL } from 'url'
import { promises as fs } from 'fs'
import tar from 'tar-stream'
import zlib from 'zlib'
import { performance } from 'perf_hooks'
import type {
  DownloadableFileModel,
  PluginModel,
  PluginRunModel,
  PluginVersionModel,
  ServerConfigModel,
  ServerSecretModel
} from '../ogm_types.js'

type Models = {
  DownloadableFile: DownloadableFileModel
  Plugin: PluginModel
  PluginVersion: PluginVersionModel
  PluginRun: PluginRunModel
  ServerConfig: ServerConfigModel
  ServerSecret: ServerSecretModel
}

type TriggerArgs = {
  downloadableFileId: string
  event: string
  models: Models
}

const ENCRYPTION_KEY = process.env.PLUGIN_SECRET_ENCRYPTION_KEY || 'your-32-char-secret-key-here!!!'
const ALGORITHM = 'aes-256-gcm'
const pluginModuleCache = new Map<string, any>()
const tarballCache = new Map<string, Buffer>()

const DOWNLOAD_EVENTS = new Set([
  'downloadableFile.created',
  'downloadableFile.updated',
  'downloadableFile.downloaded'
])

const decryptSecret = (ciphertext: string): string => {
  const parts = ciphertext.split(':')
  const iv = Buffer.from(parts[0], 'hex')
  const encrypted = parts[1]
  const decipher = crypto.createDecipher(ALGORITHM, ENCRYPTION_KEY)
  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

const downloadTarball = async (tarballUrl: string): Promise<Buffer> => {
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

const extractTarballToTempDir = async (tarballBytes: Buffer): Promise<string> => {
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

const loadPluginImplementation = async (tarballUrl: string, entryPath: string): Promise<any> => {
  const cacheKey = `${tarballUrl}:${entryPath}`
  if (pluginModuleCache.has(cacheKey)) {
    return pluginModuleCache.get(cacheKey)
  }

  const tarballBytes = await downloadTarball(tarballUrl)
  const tempDir = await extractTarballToTempDir(tarballBytes)
  const normalizedEntry = entryPath || 'dist/index.js'
  const absoluteEntryPath = path.join(tempDir, normalizedEntry)

  try {
    const moduleUrl = pathToFileURL(absoluteEntryPath).href
    const importedModule = await import(moduleUrl)
    const PluginClass = importedModule.default || importedModule
    pluginModuleCache.set(cacheKey, PluginClass)
    return PluginClass
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}

const mergeSettings = (defaults: any, overrides: any): any => {
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

const getAttachmentUrls = (downloadableFile: any): string[] => {
  const urls: string[] = []
  if (downloadableFile.url) {
    urls.push(downloadableFile.url)
  }
  return urls
}

type PipelineStep = {
  pluginId: string
  continueOnError?: boolean
  condition?: 'ALWAYS' | 'PREVIOUS_SUCCEEDED' | 'PREVIOUS_FAILED'
}

type EventPipeline = {
  event: string
  steps: PipelineStep[]
  stopOnFirstFailure?: boolean
}

type PluginEdgeData = {
  edge: {
    enabled: boolean
    settingsJson: any
  }
  node: {
    id: string
    version: string
    repoUrl: string
    tarballGsUri: string
    entryPath: string
    manifest: any
    settingsDefaults: any
    uiSchema: any
    Plugin: {
      id: string
      name: string
      displayName: string
      description: string
      metadata: any
    }
  }
}

const generatePipelineId = (): string => {
  return `pipeline-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
}

const shouldRunStep = (
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

export const triggerPluginRunsForDownloadableFile = async ({
  downloadableFileId,
  event,
  models
}: TriggerArgs) => {
  if (!DOWNLOAD_EVENTS.has(event)) {
    throw new Error(`Unsupported plugin event: ${event}`)
  }

  const { DownloadableFile, PluginRun, ServerConfig, ServerSecret } = models

  const files = await DownloadableFile.find({
    where: { id: downloadableFileId },
    selectionSet: `{
      id
      fileName
      url
      kind
      size
      Discussion {
        id
        DiscussionChannels {
          channelUniqueName
        }
      }
    }`
  })

  if (!files.length) {
    throw new Error('Downloadable file not found')
  }

  const downloadableFile = files[0]
  const fileData = downloadableFile as any
  const channelId = fileData.Discussion?.DiscussionChannels?.[0]?.channelUniqueName || null

  const serverConfigs = await ServerConfig.find({
    selectionSet: `{
      serverName
      pluginPipelines
      InstalledVersionsConnection {
        edges {
          edge {
            enabled
            settingsJson
          }
          node {
            id
            version
            repoUrl
            tarballGsUri
            entryPath
            manifest
            settingsDefaults
            uiSchema
            Plugin {
              id
              name
              displayName
              description
              metadata
            }
          }
        }
      }
    }`
  })

  const serverConfig = serverConfigs[0] as any
  if (!serverConfig) {
    return []
  }

  const edges = serverConfig.InstalledVersionsConnection?.edges || []
  const enabledPluginsMap = new Map<string, PluginEdgeData>()

  // Build a map of enabled plugins by pluginId (name)
  for (const edge of edges) {
    const edgeData = edge as PluginEdgeData
    if (edgeData.edge?.enabled && edgeData.node?.Plugin?.name) {
      enabledPluginsMap.set(edgeData.node.Plugin.name, edgeData)
    }
  }

  // Check if there's a pipeline defined for this event
  const pipelines: EventPipeline[] = serverConfig.pluginPipelines || []
  const eventPipeline = pipelines.find(p => p.event === event)

  // Generate unique pipeline ID
  const pipelineId = generatePipelineId()

  // Determine which plugins to run and in what order
  let pluginsToRun: { pluginId: string; edgeData: PluginEdgeData; step: PipelineStep; order: number }[] = []

  if (eventPipeline && eventPipeline.steps.length > 0) {
    // Use pipeline order - only run plugins that are both in the pipeline AND enabled
    eventPipeline.steps.forEach((step, index) => {
      const edgeData = enabledPluginsMap.get(step.pluginId)
      if (edgeData) {
        // Also verify the plugin handles this event type
        const manifest = edgeData.node.manifest || {}
        const manifestEvents: string[] = Array.isArray(manifest.events) ? manifest.events : []
        if (manifestEvents.includes(event)) {
          pluginsToRun.push({
            pluginId: step.pluginId,
            edgeData,
            step,
            order: index
          })
        }
      }
    })
  } else {
    // No pipeline defined - fall back to running all enabled plugins that handle this event
    let order = 0
    for (const [pluginId, edgeData] of enabledPluginsMap) {
      const manifest = edgeData.node.manifest || {}
      const manifestEvents: string[] = Array.isArray(manifest.events) ? manifest.events : []
      if (manifestEvents.includes(event)) {
        pluginsToRun.push({
          pluginId,
          edgeData,
          step: { pluginId, condition: 'ALWAYS', continueOnError: false },
          order: order++
        })
      }
    }
  }

  if (pluginsToRun.length === 0) {
    return []
  }

  const runs: any[] = []
  const stopOnFirstFailure = eventPipeline?.stopOnFirstFailure ?? true
  let previousStatus: 'SUCCEEDED' | 'FAILED' | null = null
  let pipelineStopped = false

  // Create PENDING records for all plugins first (for UI visibility)
  const pendingRuns: { id: string; pluginId: string; order: number }[] = []
  for (const { pluginId, edgeData, order } of pluginsToRun) {
    const pluginNode = edgeData.node.Plugin
    const pluginVersionData = edgeData.node

    const runCreateResult = await PluginRun.create({
      input: [
        ({
          pluginId,
          pluginName: pluginNode.displayName || pluginNode.name,
          version: pluginVersionData.version,
          scope: 'SERVER',
          channelId,
          eventType: event,
          status: 'PENDING',
          targetId: downloadableFile.id,
          targetType: 'DownloadableFile',
          pipelineId,
          executionOrder: order,
          payload: {
            fileName: fileData.fileName,
            url: fileData.url,
            event
          }
        } as any)
      ]
    })

    pendingRuns.push({
      id: runCreateResult.pluginRuns[0].id,
      pluginId,
      order
    })
  }

  // Now execute each plugin in order
  for (let i = 0; i < pluginsToRun.length; i++) {
    const { pluginId, edgeData, step, order } = pluginsToRun[i]
    const pendingRun = pendingRuns.find(r => r.pluginId === pluginId && r.order === order)
    if (!pendingRun) continue

    const pluginRunId = pendingRun.id
    const pluginVersionData = edgeData.node
    const pluginNode = pluginVersionData.Plugin

    // Check if pipeline was stopped
    if (pipelineStopped) {
      await PluginRun.update({
        where: { id: pluginRunId },
        update: ({
          status: 'SKIPPED',
          skippedReason: 'Pipeline stopped due to previous failure',
          message: 'Skipped: pipeline stopped'
        } as any)
      })

      const skipped = await PluginRun.find({
        where: { id: pluginRunId },
        selectionSet: `{
          id pluginId pluginName version scope channelId eventType status message
          durationMs targetId targetType payload pipelineId executionOrder skippedReason
          createdAt updatedAt
        }`
      })
      if (skipped[0]) runs.push(skipped[0])
      continue
    }

    // Check step condition
    if (!shouldRunStep(step, previousStatus)) {
      const reason = step.condition === 'PREVIOUS_SUCCEEDED'
        ? 'Condition not met: previous step did not succeed'
        : 'Condition not met: previous step did not fail'

      await PluginRun.update({
        where: { id: pluginRunId },
        update: ({
          status: 'SKIPPED',
          skippedReason: reason,
          message: `Skipped: ${reason}`
        } as any)
      })

      const skipped = await PluginRun.find({
        where: { id: pluginRunId },
        selectionSet: `{
          id pluginId pluginName version scope channelId eventType status message
          durationMs targetId targetType payload pipelineId executionOrder skippedReason
          createdAt updatedAt
        }`
      })
      if (skipped[0]) runs.push(skipped[0])
      continue
    }

    // Update status to RUNNING
    await PluginRun.update({
      where: { id: pluginRunId },
      update: ({ status: 'RUNNING' } as any)
    })

    const runStart = performance.now()
    const logs: string[] = []
    const flags: any[] = []

    try {
      const tarballUrl = pluginVersionData.tarballGsUri || pluginVersionData.repoUrl
      const PluginClass = await loadPluginImplementation(tarballUrl, pluginVersionData.entryPath || 'dist/index.js')

      const serverSecrets = await ServerSecret.find({
        where: { pluginId },
        selectionSet: `{
          key
          ciphertext
        }`
      })

      const decryptedSecrets: Record<string, string> = {}
      for (const secret of serverSecrets) {
        try {
          decryptedSecrets[secret.key] = decryptSecret(secret.ciphertext)
        } catch (error) {
          logs.push(`Failed to decrypt secret ${secret.key}: ${(error as any).message}`)
        }
      }

      const settingsDefaults = pluginVersionData.settingsDefaults || {}
      const settingsJson = edgeData.edge?.settingsJson || {}
      const runtimeSettings = mergeSettings(settingsDefaults, settingsJson)
      const attachments = getAttachmentUrls(downloadableFile)

      const context = {
        scope: 'SERVER' as const,
        channelId,
        settings: runtimeSettings,
        secrets: {
          server: decryptedSecrets
        },
        log: (...args: any[]) => {
          const message = args.map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')
          logs.push(message)
          console.log(`[Plugin:${pluginId}]`, message)
        },
        storeFlag: async (flag: any) => {
          flags.push(flag)
        }
      }

      const pluginInstance = new PluginClass(context)
      const eventEnvelope = {
        type: event,
        payload: {
          discussionId: fileData.Discussion?.id,
          attachmentUrls: attachments,
          downloadableFileId: fileData.id
        }
      }

      const result = await pluginInstance.handleEvent(eventEnvelope)
      const runEnd = performance.now()
      const durationMs = Math.round(runEnd - runStart)

      const succeeded = result?.success !== false
      previousStatus = succeeded ? 'SUCCEEDED' : 'FAILED'

      await PluginRun.update({
        where: { id: pluginRunId },
        update: ({
          status: succeeded ? 'SUCCEEDED' : 'FAILED',
          message: succeeded
            ? (result?.result?.message || 'Plugin run completed')
            : (result?.error || 'Plugin reported failure'),
          durationMs,
          payload: {
            event,
            attachments,
            flags,
            logs,
            result
          }
        } as any)
      })

      // Check if we should stop the pipeline
      if (!succeeded && stopOnFirstFailure && !step.continueOnError) {
        pipelineStopped = true
      }

      const updated = await PluginRun.find({
        where: { id: pluginRunId },
        selectionSet: `{
          id pluginId pluginName version scope channelId eventType status message
          durationMs targetId targetType payload pipelineId executionOrder skippedReason
          createdAt updatedAt
        }`
      })

      if (updated[0]) {
        runs.push(updated[0])
      }
    } catch (error) {
      const runEnd = performance.now()
      const durationMs = Math.round(runEnd - runStart)
      const message = (error as any).message || 'Plugin execution failed'

      previousStatus = 'FAILED'

      await PluginRun.update({
        where: { id: pluginRunId },
        update: ({
          status: 'FAILED',
          message,
          durationMs,
          payload: {
            event,
            error: message,
            logs,
            flags
          }
        } as any)
      })

      // Check if we should stop the pipeline
      if (stopOnFirstFailure && !step.continueOnError) {
        pipelineStopped = true
      }

      const updated = await PluginRun.find({
        where: { id: pluginRunId },
        selectionSet: `{
          id pluginId pluginName version scope channelId eventType status message
          durationMs targetId targetType payload pipelineId executionOrder skippedReason
          createdAt updatedAt
        }`
      })

      if (updated[0]) {
        runs.push(updated[0])
      }
    }
  }

  return runs
}

export const isSupportedEvent = (event: string) => DOWNLOAD_EVENTS.has(event)
