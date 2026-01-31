import { performance } from 'perf_hooks'
import type { ChannelTriggerArgs, PluginEdgeData, EventPipeline, PluginToRun, PendingRun } from './types.js'
import { CHANNEL_EVENTS } from './constants.js'
import { decryptSecret } from './encryption.js'
import { loadPluginImplementation } from './pluginLoader.js'
import { generatePipelineId, shouldRunStep, mergeSettings } from './pipelineUtils.js'

export const isChannelEvent = (event: string) => CHANNEL_EVENTS.has(event)

/**
 * Triggers channel-scoped plugin pipelines when content is submitted to a channel.
 * This runs plugins configured in the Channel's pluginPipelines field.
 */
export const triggerChannelPluginPipeline = async ({
  discussionId,
  channelUniqueName,
  event,
  models
}: ChannelTriggerArgs) => {
  if (!CHANNEL_EVENTS.has(event)) {
    throw new Error(`Unsupported channel plugin event: ${event}`)
  }

  const { Channel, Discussion, DownloadableFile, PluginRun, ServerConfig, ServerSecret } = models

  // Get the channel with its pipeline configuration
  const channels = await Channel.find({
    where: { uniqueName: channelUniqueName },
    selectionSet: `{
      uniqueName
      displayName
      pluginPipelines
      Tags {
        text
      }
      FilterGroups(options: { sort: [{ order: ASC }] }) {
        id
        key
        displayName
        mode
        order
        options(options: { sort: [{ order: ASC }] }) {
          id
          value
          displayName
          order
        }
      }
    }`
  })

  if (!channels.length) {
    throw new Error(`Channel "${channelUniqueName}" not found`)
  }

  const channel = channels[0] as any
  const channelPipelines: EventPipeline[] = channel.pluginPipelines || []
  const eventPipeline = channelPipelines.find(p => p.event === event)

  // If no pipeline is configured for this event, nothing to do
  if (!eventPipeline || eventPipeline.steps.length === 0) {
    return []
  }

  // Get the discussion with its downloadable file
  const discussions = await Discussion.find({
    where: { id: discussionId },
    selectionSet: `{
      id
      title
      body
      DownloadableFile {
        id
        fileName
        url
        kind
        size
      }
    }`
  })

  if (!discussions.length) {
    throw new Error(`Discussion "${discussionId}" not found`)
  }

  const discussion = discussions[0] as any
  const downloadableFile = discussion.DownloadableFile

  // If no downloadable file, nothing to process
  if (!downloadableFile) {
    return []
  }

  // Get server config for enabled plugins (channels can only use server-enabled plugins)
  const serverConfigs = await ServerConfig.find({
    selectionSet: `{
      serverName
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
  const enabledPluginsMap = new Map<string, PluginEdgeData>()

  // Build a map of enabled plugins by pluginId (name)
  for (const edge of edges) {
    const edgeData = edge as PluginEdgeData
    if (edgeData.properties?.enabled && edgeData.node?.Plugin?.name) {
      enabledPluginsMap.set(edgeData.node.Plugin.name, edgeData)
    }
  }

  // Filter pipeline steps to only include server-enabled plugins
  const pluginsToRun: PluginToRun[] = []

  eventPipeline.steps.forEach((step, index) => {
    const edgeData = enabledPluginsMap.get(step.pluginId)
    if (edgeData) {
      pluginsToRun.push({
        pluginId: step.pluginId,
        edgeData,
        step,
        order: index
      })
    }
  })

  if (pluginsToRun.length === 0) {
    return []
  }

  const pipelineId = generatePipelineId()
  const runs: any[] = []
  const stopOnFirstFailure = eventPipeline?.stopOnFirstFailure ?? true
  let previousStatus: 'SUCCEEDED' | 'FAILED' | null = null
  let pipelineStopped = false

  // Create PENDING records for all plugins first
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
          scope: 'CHANNEL',
          channelId: channelUniqueName,
          eventType: event,
          status: 'PENDING',
          targetId: discussionId,
          targetType: 'Discussion',
          pipelineId,
          executionOrder: order,
          payload: JSON.stringify({
            discussionId,
            channelUniqueName,
            fileName: downloadableFile.fileName,
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

  // Execute each plugin in order
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

      // Build channel context for plugins
      const channelContext = {
        uniqueName: channel.uniqueName,
        displayName: channel.displayName,
        tags: (channel.Tags || []).map((t: any) => t.text),
        filterGroups: (channel.FilterGroups || []).map((fg: any) => ({
          id: fg.id,
          key: fg.key,
          displayName: fg.displayName,
          mode: fg.mode,
          order: fg.order,
          options: (fg.options || []).map((opt: any) => ({
            id: opt.id,
            value: opt.value,
            displayName: opt.displayName,
            order: opt.order
          }))
        }))
      }

      const context = {
        scope: 'CHANNEL' as const,
        channelId: channelUniqueName,
        settings: runtimeSettings,
        secrets: {
          server: decryptedSecrets
        },
        log: (...args: any[]) => {
          const message = args.map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')
          logs.push(message)
          console.log(`[Plugin:${pluginId}:${channelUniqueName}]`, message)
        },
        storeFlag: async (flag: any) => {
          flags.push(flag)
        }
      }

      const pluginInstance = new PluginClass(context)
      const eventEnvelope = {
        type: event,
        payload: {
          discussionId: discussion.id,
          discussionTitle: discussion.title,
          discussionBody: discussion.body,
          downloadableFileId: downloadableFile.id,
          fileName: downloadableFile.fileName,
          fileSize: downloadableFile.size,
          fileUrl: downloadableFile.url,
          channel: channelContext
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
            channel: channelContext,
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
