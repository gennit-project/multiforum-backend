import { performance } from 'perf_hooks'
import type { TriggerArgs, PluginEdgeData, EventPipeline, PipelineStep, PluginToRun, PendingRun } from './types.js'
import { DOWNLOAD_EVENTS } from './constants.js'
import { decryptSecret } from './encryption.js'
import { loadPluginImplementation } from './pluginLoader.js'
import { generatePipelineId, shouldRunStep, mergeSettings, getAttachmentUrls, parseManifest, buildPluginVersionMaps, getPluginForStep } from './pipelineUtils.js'

export const isSupportedEvent = (event: string) => DOWNLOAD_EVENTS.has(event)

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
          properties {
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

  // Build version-aware plugin map (pluginName -> sorted array of versions)
  const pluginVersionsMap = buildPluginVersionMaps(edges)

  // Check if there's a pipeline defined for this event
  const pipelines: EventPipeline[] = serverConfig.pluginPipelines || []
  const eventPipeline = pipelines.find(p => p.event === event)

  // Generate unique pipeline ID
  const pipelineId = generatePipelineId()

  // Determine which plugins to run and in what order
  let pluginsToRun: PluginToRun[] = []

  if (eventPipeline && eventPipeline.steps.length > 0) {
    // Use pipeline order - only run plugins that are both in the pipeline AND enabled
    eventPipeline.steps.forEach((step, index) => {
      // Get plugin for step, respecting version specification
      const pluginMatch = getPluginForStep(pluginVersionsMap, step.pluginId, step.version)
      if (pluginMatch) {
        const { edgeData } = pluginMatch
        // Also verify the plugin handles this event type
        const manifest = parseManifest(edgeData.node.manifest)
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
    // No pipeline defined - fall back to running latest version of all enabled plugins that handle this event
    let order = 0
    for (const [pluginId, versions] of pluginVersionsMap) {
      // Use latest version (first in sorted array)
      const latestVersion = versions[0]
      if (latestVersion) {
        const manifest = parseManifest(latestVersion.edgeData.node.manifest)
        const manifestEvents: string[] = Array.isArray(manifest.events) ? manifest.events : []
        if (manifestEvents.includes(event)) {
          pluginsToRun.push({
            pluginId,
            edgeData: latestVersion.edgeData,
            step: { pluginId, condition: 'ALWAYS', continueOnError: false },
            order: order++
          })
        }
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
  const pendingRuns: PendingRun[] = []
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
          payload: JSON.stringify({
            fileName: fileData.fileName,
            url: fileData.url,
            event
          }),
          updatedAt: new Date().toISOString()
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
      const settingsJson = edgeData.properties?.settingsJson || {}
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
          payload: JSON.stringify({
            event,
            attachments,
            flags,
            logs,
            result
          })
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
          payload: JSON.stringify({
            event,
            error: message,
            logs,
            flags
          })
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
