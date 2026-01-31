import { performance } from 'perf_hooks'
import type { CommentTriggerArgs, PluginEdgeData, PluginToRun, PendingRun } from './types.js'
import { COMMENT_EVENTS } from './constants.js'
import { decryptSecret } from './encryption.js'
import { loadPluginImplementation } from './pluginLoader.js'
import { generatePipelineId, shouldRunStep, mergeSettings, parseStoredPipelines, parseManifest } from './pipelineUtils.js'
import { createBotComment } from '../botUserService.js'

export const isCommentEvent = (event: string) => COMMENT_EVENTS.has(event)

export const triggerPluginRunsForComment = async ({
  commentId,
  event,
  models
}: CommentTriggerArgs) => {
  if (!COMMENT_EVENTS.has(event)) {
    throw new Error(`Unsupported comment plugin event: ${event}`)
  }

  const { Channel, Comment, PluginRun, ServerConfig, ServerSecret, User } = models

  const comments = await Comment.find({
    where: { id: commentId },
    selectionSet: `{
      id
      text
      botMentions
      isFeedbackComment
      createdAt
      CommentAuthor {
        ... on User {
          username
          displayName
          isBot
        }
        ... on ModerationProfile {
          displayName
          User {
            username
          }
        }
      }
      DiscussionChannel {
        id
        discussionId
        channelUniqueName
        Discussion {
          id
          title
          body
        }
      }
      Channel {
        uniqueName
        displayName
      }
      Event {
        id
        title
        EventChannels {
          channelUniqueName
        }
      }
      Issue {
        id
      }
      ParentComment {
        id
      }
    }`
  })

  if (!comments.length) {
    throw new Error(`Comment "${commentId}" not found`)
  }

  const comment = comments[0] as any
  const discussionChannel = comment.DiscussionChannel || null
  const isDiscussionComment =
    Boolean(discussionChannel?.id) &&
    !comment.isFeedbackComment &&
    !comment.Event?.id &&
    !comment.Issue?.id

  if (!isDiscussionComment) {
    return []
  }

  const channelUniqueName =
    discussionChannel?.channelUniqueName ||
    comment.Channel?.uniqueName ||
    comment.Event?.EventChannels?.[0]?.channelUniqueName ||
    null

  if (!channelUniqueName) {
    return []
  }

  // Fetch channel pipelines
  const channels = await Channel.find({
    where: { uniqueName: channelUniqueName },
    selectionSet: `{ uniqueName pluginPipelines }`
  })
  const channel = channels[0] as any

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
  const enabledPluginsMap = new Map<string, PluginEdgeData>()

  for (const edge of edges) {
    const edgeData = edge as PluginEdgeData
    if (edgeData.properties?.enabled && edgeData.node?.Plugin?.name) {
      enabledPluginsMap.set(edgeData.node.Plugin.name, edgeData)
    }
  }

  // Check channel pipelines first, then fall back to server pipelines
  const channelPipelines = parseStoredPipelines(channel?.pluginPipelines)
  const serverPipelines = parseStoredPipelines(serverConfig.pluginPipelines)

  // For comment.created, prefer channel pipelines
  let eventPipeline = channelPipelines.find(p => p.event === event)
  if (!eventPipeline) {
    eventPipeline = serverPipelines.find(p => p.event === event)
  }

  // Debug: Show enabled plugins
  const enabledPluginNames = Array.from(enabledPluginsMap.keys())
  const enabledPluginDetails = Array.from(enabledPluginsMap.entries()).map(([name, edge]) => {
    const manifest = parseManifest(edge.node.manifest)
    return {
      name,
      version: edge.node.version,
      manifestEvents: manifest.events || []
    }
  })

  console.log('[Plugin] Pipeline check:', {
    event,
    channelUniqueName,
    channelPipelinesCount: channelPipelines.length,
    serverPipelinesCount: serverPipelines.length,
    foundEventPipeline: !!eventPipeline,
    enabledPlugins: enabledPluginDetails,
    pipelineSteps: eventPipeline?.steps || []
  })

  const pipelineId = generatePipelineId()

  let pluginsToRun: PluginToRun[] = []

  if (eventPipeline && eventPipeline.steps.length > 0) {
    eventPipeline.steps.forEach((step, index) => {
      const edgeData = enabledPluginsMap.get(step.pluginId)
      console.log(`[Plugin] Step ${index}: pluginId="${step.pluginId}", found=${!!edgeData}`)
      if (edgeData) {
        const manifest = parseManifest(edgeData.node.manifest)
        const manifestEvents: string[] = Array.isArray(manifest.events) ? manifest.events : []
        const eventMatch = manifestEvents.includes(event)
        console.log(`[Plugin] Step ${index}: manifestEvents=${JSON.stringify(manifestEvents)}, eventMatch=${eventMatch}`)
        if (eventMatch) {
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
    let order = 0
    for (const [pluginId, edgeData] of enabledPluginsMap) {
      const manifest = parseManifest(edgeData.node.manifest)
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
          channelId: channelUniqueName,
          eventType: event,
          status: 'PENDING',
          targetId: comment.id,
          targetType: 'Comment',
          pipelineId,
          executionOrder: order,
          payload: JSON.stringify({
            event,
            commentId: comment.id,
            channelUniqueName
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

  for (let i = 0; i < pluginsToRun.length; i++) {
    const { pluginId, edgeData, step, order } = pluginsToRun[i]
    const pendingRun = pendingRuns.find(r => r.pluginId === pluginId && r.order === order)
    if (!pendingRun) continue

    const pluginRunId = pendingRun.id
    const pluginVersionData = edgeData.node
    const pluginNode = pluginVersionData.Plugin

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

      const context = {
        scope: 'SERVER' as const,
        channelId: channelUniqueName,
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
        },
        createCommentAsBot: async (input: {
          text: string
          botName: string
          profileId?: string | null
          profileLabel?: string | null
          parentCommentId?: string | null
        }) => {
          return createBotComment({
            Comment,
            User,
            Channel,
            channelUniqueName,
            text: input.text,
            botName: input.botName,
            profileId: input.profileId || null,
            profileLabel: input.profileLabel || null,
            parentCommentId: input.parentCommentId || null,
            discussionChannelId: comment.DiscussionChannel?.id || null,
            eventId: comment.Event?.id || null
          })
        }
      }

      const authorInfo = (() => {
        if (comment.CommentAuthor?.username) {
          return {
            username: comment.CommentAuthor.username,
            displayName: comment.CommentAuthor.displayName || null,
            isBot: comment.CommentAuthor.isBot || false
          }
        }
        if (comment.CommentAuthor?.User?.username) {
          return {
            username: comment.CommentAuthor.User.username,
            displayName: comment.CommentAuthor.displayName || null,
            isBot: false
          }
        }
        return null
      })()

      const eventEnvelope = {
        type: event,
        payload: {
          commentId: comment.id,
          commentText: comment.text,
          botMentions: (() => {
            if (!comment.botMentions) {
              return []
            }
            if (typeof comment.botMentions === 'string') {
              try {
                const parsed = JSON.parse(comment.botMentions)
                return Array.isArray(parsed) ? parsed : []
              } catch {
                return []
              }
            }
            if (Array.isArray(comment.botMentions)) {
              return comment.botMentions
            }
            return []
          })(),
          isFeedbackComment: comment.isFeedbackComment || false,
          createdAt: comment.createdAt,
          author: authorInfo,
          discussion: discussionChannel?.Discussion
            ? {
                id: discussionChannel.Discussion.id,
                title: discussionChannel.Discussion.title,
                body: discussionChannel.Discussion.body
              }
            : null,
          channel: {
            uniqueName: channelUniqueName,
            displayName: comment.Channel?.displayName || null
          },
          parentCommentId: comment.ParentComment?.id || null
        }
      }

      const pluginInstance = new PluginClass(context)
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
            flags,
            logs,
            result
          })
        } as any)
      })

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

      if (stopOnFirstFailure && !step.continueOnError) {
        pipelineStopped = true
      }
    }
  }

  return runs
}
