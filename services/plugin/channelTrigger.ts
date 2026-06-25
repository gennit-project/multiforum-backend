import { performance } from 'perf_hooks'
import type { ChannelTriggerArgs, PluginEdgeData, EventPipeline, PluginToRun, PendingRun } from './types.js'
import { CHANNEL_EVENTS } from './constants.js'
import { decryptSecret } from './encryption.js'
import { loadPluginImplementation } from './pluginLoader.js'
import { generatePipelineId, shouldRunStep, mergeSettings, buildPluginVersionMaps, getPluginForStep } from './pipelineUtils.js'
import { buildBotInvocationContext } from './buildBotInvocationContext.js'
import { createPromptDebugLogger } from './promptDebug.js'
import type { PluginRunCreateInput, PluginRunUpdateInput, Channel, Discussion, DownloadableFile, ServerConfig } from '../../ogm_types.js'
import { logger } from "../../logger.js";

export const isChannelEvent = (event: string) => CHANNEL_EVENTS.has(event)

/**
 * Triggers channel-scoped plugin pipelines when content is submitted to a channel.
 * This runs plugins configured in the Channel's pluginPipelines field.
 */
export const triggerChannelPluginPipeline = async (
  {
    discussionId,
    channelUniqueName,
    event,
    models
  }: ChannelTriggerArgs,
  // Injectable plugin loader so the execution path can be tested without
  // downloading/running a real plugin tarball. Defaults to the real loader.
  { loadPlugin = loadPluginImplementation }: { loadPlugin?: typeof loadPluginImplementation } = {}
) => {
  if (!CHANNEL_EVENTS.has(event)) {
    throw new Error(`Unsupported channel plugin event: ${event}`)
  }

  const { Channel, Discussion, DownloadableFile, PluginRun, ServerConfig, ServerSecret } = models

  // Get the channel with its pipeline configuration and enabled plugins (for channel-level settings)
  const channels = await Channel.find({
    where: { uniqueName: channelUniqueName },
    selectionSet: `{
      uniqueName
      displayName
      description
      rules
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
      EnabledPluginsConnection {
        edges {
          properties {
            enabled
            settingsJson
          }
          node {
            id
            version
            Plugin {
              id
              name
            }
          }
        }
      }
    }`
  })

  if (!channels.length) {
    throw new Error(`Channel "${channelUniqueName}" not found`)
  }

  const channel: Channel = channels[0]
  const channelPipelines: EventPipeline[] = channel.pluginPipelines || []
  const eventPipeline = channelPipelines.find(p => p.event === event)

  // Build a map of channel-level plugin settings by plugin name
  const channelPluginSettingsMap = new Map<string, unknown>()
  if (channel?.EnabledPluginsConnection?.edges) {
    for (const edge of channel.EnabledPluginsConnection.edges) {
      const pluginName = edge.node?.Plugin?.name
      if (pluginName && edge.properties?.settingsJson) {
        channelPluginSettingsMap.set(pluginName, edge.properties.settingsJson)
      }
    }
  }

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

  // The runtime schema exposes a singular `DownloadableFile` on Discussion that
  // the generated type (which only has the `DownloadableFiles` array) doesn't
  // model yet, so extend the generated type with that queried field.
  const discussion = discussions[0] as Discussion & {
    DownloadableFile?: DownloadableFile | null
  }
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

  const serverConfig: ServerConfig | undefined = serverConfigs[0]
  if (!serverConfig) {
    return []
  }

  const edges = serverConfig.InstalledVersionsConnection?.edges || []

  // Build version-aware plugin map (pluginName -> sorted array of versions).
  // The generated relationship edge type is cast to the plugin layer's
  // structurally-compatible PluginEdgeData at this consumer boundary.
  const pluginVersionsMap = buildPluginVersionMaps(
    edges as unknown as PluginEdgeData[]
  )

  // Filter pipeline steps to only include server-enabled plugins
  const pluginsToRun: PluginToRun[] = []

  eventPipeline.steps.forEach((step, index) => {
    // Get plugin for step, respecting version specification
    const pluginMatch = getPluginForStep(pluginVersionsMap, step.pluginId, step.version)
    if (pluginMatch) {
      pluginsToRun.push({
        pluginId: step.pluginId,
        edgeData: pluginMatch.edgeData,
        step,
        order: index
      })
    }
  })

  if (pluginsToRun.length === 0) {
    return []
  }

  const pipelineId = generatePipelineId()
  const runs: unknown[] = []
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
        } as PluginRunCreateInput)
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
        } as PluginRunUpdateInput)
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
        } as PluginRunUpdateInput)
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
      update: ({ status: 'RUNNING' } as PluginRunUpdateInput)
    })

    const runStart = performance.now()
    const logs: string[] = []
    const flags: unknown[] = []

    try {
      const tarballUrl = pluginVersionData.tarballGsUri || pluginVersionData.repoUrl
      const PluginClass = await loadPlugin(tarballUrl, pluginVersionData.entryPath || 'dist/index.js')

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
          logs.push(`Failed to decrypt secret ${secret.key}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      // Parse settings if they are JSON strings
      const parseIfString = (value: unknown): Record<string, unknown> => {
        if (typeof value === 'string') {
          try {
            return JSON.parse(value)
          } catch {
            return {}
          }
        }
        return (value as Record<string, unknown>) || {}
      }

      // Merge settings: defaults < server < channel (channel takes highest precedence)
      const settingsDefaults = parseIfString(pluginVersionData.settingsDefaults)
      const serverSettingsJson = parseIfString(edgeData.properties?.settingsJson)
      const channelSettingsJsonRaw = parseIfString(channelPluginSettingsMap.get(pluginId))

      // Channel settings are stored flat but need to be merged into the 'channel' sub-key
      // to match the plugin's expected structure: { server: {...}, channel: {...} }
      const channelSettingsJson = Object.keys(channelSettingsJsonRaw).length > 0
        ? { channel: channelSettingsJsonRaw }
        : {}

      const runtimeSettings = mergeSettings(
        mergeSettings(settingsDefaults, serverSettingsJson),
        channelSettingsJson
      )

      // Build channel context for plugins
      const channelContext = {
        uniqueName: channel.uniqueName,
        displayName: channel.displayName,
        tags: (channel.Tags || []).map((t: { text: string }) => t.text),
        filterGroups: (channel.FilterGroups || []).map((fg: {
          id: string
          key: string
          displayName: string
          mode: string
          order: number
          options?: Array<{ id: string; value: string; displayName: string; order: number }>
        }) => ({
          id: fg.id,
          key: fg.key,
          displayName: fg.displayName,
          mode: fg.mode,
          order: fg.order,
          options: (fg.options || []).map((opt: { id: string; value: string; displayName: string; order: number }) => ({
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
        log: (...args: unknown[]) => {
          const message = args.map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')
          logs.push(message)
          logger.info(`[Plugin:${pluginId}:${channelUniqueName}]`, message)
        },
        storeFlag: async (flag: unknown) => {
          flags.push(flag)
        },
        logPromptDebug: createPromptDebugLogger({
          pluginId,
          channelId: channelUniqueName,
          logs
        })
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
          channel: channelContext,
          context: buildBotInvocationContext({
            invocationType: 'discussion-created',
            channel: {
              uniqueName: channel.uniqueName,
              displayName: channel.displayName,
              description: channel.description,
              rules: channel.rules
            },
            discussion: {
              id: discussion.id,
              title: discussion.title,
              body: discussion.body
            }
          })
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
        } as PluginRunUpdateInput)
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
      const message = (error instanceof Error ? error.message : '') || 'Plugin execution failed'

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
        } as PluginRunUpdateInput)
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
