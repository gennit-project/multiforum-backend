import { createBotThreadRepository } from "../persistence/botThreadRepository.js"
import {createCommentExecutionRepository, type CommentExecutionRepository} from "../persistence/commentExecutionRepository.js";
import type { PipelineAttemptRepository } from "../persistence/pipelineAttemptRepository.js";
import type { PipelineLeaseRepository } from "../persistence/pipelineLeaseRepository.js";
import { performance } from 'perf_hooks'
import type { CommentTriggerArgs, EventTriggerExecutionOptions, PluginEdgeData, PluginToRun, PendingRun } from './types.js'
import { COMMENT_EVENTS, PLUGIN_EVENTS } from './constants.js'
import { decryptSecret } from './encryption.js'
import { loadPluginImplementation } from './pluginLoader.js'
import { generatePipelineId, shouldRunStep, mergeSettings, parseStoredPipelines, parseManifest, buildPluginVersionMaps, getPluginForStep } from './pipelineUtils.js'
import {
  completePipelineAttempt,
  createPipelineAttempt,
  type PipelineJobStatus,
} from './pipelineAttempt.js'
import {
  cancelSupersededPluginRuns,
  claimPluginRunLease,
  completePluginRunLease,
  createQueuedPluginRunTiming,
  startPluginRunHeartbeat,
} from './executionLease.js'
import {
  createPublicDiagnosticCollector,
  type PublicDiagnostic,
} from './publicDiagnostics.js'
import { createBotComment, buildBotUsername } from '../botUserService.js'
import { createBotReport } from '../botReportService.js'
import { buildBotInvocationContext, collectParentCommentThread } from './buildBotInvocationContext.js'
import { createPromptDebugLogger } from './promptDebug.js'
import { getActiveSuspension } from '../../rules/permission/getActiveSuspension.js'
import { createChannelPermissionRepository } from '../persistence/channelPermissionRepository.js'
import type { PluginRunCreateInput, PluginRunUpdateInput, Channel, Comment, ServerConfig } from '../../ogm_types.js'
import { logger } from "../../logger.js";
import {
  createContentRevisionHash,
  createReportIdempotencyKey,
  createRuleSetVersion,
} from './moderationJobIdentity.js'
import {
  parseStoredPipelineConfiguration,
  pipelineFromStoredConfiguration,
} from './queuedPipeline.js'

export const isCommentEvent = (event: string) => COMMENT_EVENTS.has(event)

const isPipelineJobStatus = (value: unknown): value is PipelineJobStatus =>
  typeof value === 'string' && [
    'PENDING',
    'RUNNING',
    'SUCCEEDED',
    'FAILED',
    'SKIPPED',
    'TIMED_OUT',
    'CANCELLED',
  ].includes(value)

export const triggerPluginRunsForComment = async (
  {
    commentId,
    event,
    driver
  }: CommentTriggerArgs,
  // Injectable plugin loader so the execution path can be tested without
  // downloading/running a real plugin tarball. Defaults to the real loader.
  {
    loadPlugin = loadPluginImplementation,
    leaseRepository,
    attemptRepository,
    commentRepository,
    getSuspension = getActiveSuspension,
    reportAsBot = createBotReport,
    execution = {},
  }: {
    loadPlugin?: typeof loadPluginImplementation
    leaseRepository?: PipelineLeaseRepository
    attemptRepository?: PipelineAttemptRepository
    commentRepository?: CommentExecutionRepository
    getSuspension?: typeof getActiveSuspension
    reportAsBot?: typeof createBotReport
    execution?: EventTriggerExecutionOptions
  } = {}
) => {
  if (!COMMENT_EVENTS.has(event)) {
    throw new Error(`Unsupported comment plugin event: ${event}`)
  }

  const repository = commentRepository ?? createCommentExecutionRepository(driver!)

  const comments = await repository.findComment(commentId)

  if (!comments.length) {
    throw new Error(`Comment "${commentId}" not found`)
  }

  // The selectionSet flattens CommentAuthor's inline-fragment fields (User and
  // ModerationProfile branches) into a single accessor shape that the generated
  // `Comment.CommentAuthor` union (User | ModerationProfile) doesn't model, so
  // intersect the generated type with the queried author shape.
  const comment = comments[0] as Comment & {
    CommentAuthor?: {
      username?: string | null
      displayName?: string | null
      isBot?: boolean | null
      User?: { username?: string | null } | null
    } | null
  }
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

  // Fetch channel pipelines and enabled plugins (for channel-level settings)
  const channels = await repository.findChannel(channelUniqueName)
  const channel: Channel = channels[0]
  const parentComments = await collectParentCommentThread({
    repository: createBotThreadRepository(driver),
    parentCommentId: comment.ParentComment?.id || null
  })

  type ChannelPluginState = {
    enabled: boolean
    settingsJson: unknown
  }
  const channelPluginStatesByVersionId = new Map<string, ChannelPluginState>()
  const channelPluginStatesByName = new Map<string, ChannelPluginState>()
  if (channel?.EnabledPluginsConnection?.edges) {
    for (const edge of channel.EnabledPluginsConnection.edges) {
      const state = {
        enabled: edge.properties?.enabled === true,
        settingsJson: edge.properties?.settingsJson,
      }
      if (edge.node?.id) {
        channelPluginStatesByVersionId.set(edge.node.id, state)
      }
      const pluginName = edge.node?.Plugin?.name
      const existing = pluginName && !edge.node?.id
        ? channelPluginStatesByName.get(pluginName)
        : undefined
      if (
        pluginName &&
        !edge.node?.id &&
        (!existing || (!existing.enabled && state.enabled))
      ) {
        channelPluginStatesByName.set(pluginName, state)
      }
    }
  }

  const serverConfigs = await repository.findConfiguration()

  const serverConfig: ServerConfig | undefined = serverConfigs[0]
  if (!serverConfig) {
    return []
  }

  const edges = serverConfig.InstalledVersionsConnection?.edges || []

  // Build version-aware plugin map (pluginName -> sorted array of versions)
  const pluginVersionsMap = buildPluginVersionMaps(edges as unknown as PluginEdgeData[])

  // Check channel pipelines first, then fall back to server pipelines
  const channelPipelines = parseStoredPipelines(channel?.pluginPipelines)
  const serverPipelines = parseStoredPipelines(serverConfig.pluginPipelines)

  // For comment.created, prefer channel pipelines
  let eventPipeline = channelPipelines.find(p => p.event === event)
  if (!eventPipeline) {
    eventPipeline = serverPipelines.find(p => p.event === event)
  }

  const storedConfiguration = execution.resume
    ? parseStoredPipelineConfiguration(execution.resume.configurationSnapshot)
    : null
  if (execution.resume && !storedConfiguration) {
    throw new Error(`Queued pipeline "${execution.resume.pipelineId}" has an invalid configuration snapshot`)
  }
  if (storedConfiguration) {
    if (storedConfiguration.event !== event) {
      throw new Error(`Queued pipeline event "${storedConfiguration.event}" does not match "${event}"`)
    }
    eventPipeline = pipelineFromStoredConfiguration(storedConfiguration)
  }

  // Debug: Show enabled plugins (all versions)
  const enabledPluginDetails: Array<{ name: string; version: string; manifestEvents: string[] }> = []
  for (const [name, versions] of pluginVersionsMap) {
    for (const { version, edgeData } of versions) {
      const manifest = parseManifest(edgeData.node.manifest)
      enabledPluginDetails.push({
        name,
        version,
        manifestEvents: Array.isArray(manifest.events) ? manifest.events : []
      })
    }
  }

  logger.info('[Plugin] Pipeline check:', {
    event,
    channelUniqueName,
    channelPipelinesCount: channelPipelines.length,
    serverPipelinesCount: serverPipelines.length,
    foundEventPipeline: !!eventPipeline,
    enabledPlugins: enabledPluginDetails,
    pipelineSteps: eventPipeline?.steps || []
  })

  const pipelineId = execution.resume?.pipelineId || generatePipelineId()

  let pluginsToRun: PluginToRun[] = []

  if (eventPipeline && eventPipeline.steps.length > 0) {
    eventPipeline.steps.forEach((step, index) => {
      // Get plugin for step, respecting version specification
      const pluginMatch = getPluginForStep(pluginVersionsMap, step.pluginId, step.version)
      logger.info(`[Plugin] Step ${index}: pluginId="${step.pluginId}", requestedVersion="${step.version || 'latest'}", found=${!!pluginMatch}${pluginMatch ? `, resolvedVersion="${pluginMatch.version}"` : ''}`)

      if (pluginMatch) {
        const { edgeData, version } = pluginMatch
        const manifest = parseManifest(edgeData.node.manifest)
        const manifestEvents: string[] = Array.isArray(manifest.events) ? manifest.events : []
        const eventMatch = manifestEvents.includes(event)
        logger.info(`[Plugin] Step ${index}: version=${version}, manifestEvents=${JSON.stringify(manifestEvents)}, eventMatch=${eventMatch}`)
        if (eventMatch) {
          pluginsToRun.push({
            pluginId: step.pluginId,
            edgeData,
            step,
            order: storedConfiguration?.steps[index]?.order ?? index
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

  const contentRevisionHash = createContentRevisionHash({
    channelUniqueName,
    contentId: comment.id,
    contentType: 'Comment',
    text: comment.text,
  })
  const isCurrentContentRevision = async () => {
    const currentComments = await repository.findComment(comment.id)
    const currentComment = currentComments[0]
    if (!currentComment) return false
    return createContentRevisionHash({
      channelUniqueName,
      contentId: currentComment.id,
      contentType: 'Comment',
      text: currentComment.text,
    }) === contentRevisionHash
  }
  const serverRules = Array.isArray(serverConfig.rules) ? serverConfig.rules : []
  const forumRules = Array.isArray(channel.rules) ? channel.rules : []

  const runs: unknown[] = []
  const resumedRunsByOrder = new Map(
    (execution.resume?.runs || []).map(run => [run.order, run])
  )
  const jobStatuses: PipelineJobStatus[] = pluginsToRun.map(({ order }) => {
    const status = resumedRunsByOrder.get(order)?.status
    return isPipelineJobStatus(status) ? status : 'PENDING'
  })
  const stopOnFirstFailure = eventPipeline?.stopOnFirstFailure ?? true
  let previousStatus: 'SUCCEEDED' | 'FAILED' | null = null
  let pipelineStopped = false

  if (!execution.resume) {
    await createPipelineAttempt({
      driver,
      repository: attemptRepository,
      startImmediately: !execution.deferExecution,
      context: {
      pipelineId,
      targetId: comment.id,
      targetType: 'Comment',
      targetVersion: contentRevisionHash,
      eventType: event,
      scope: 'SERVER',
      channelId: channelUniqueName,
      eventPipeline,
      pluginsToRun,
      },
    })
  } else if (execution.resume.targetVersion !== contentRevisionHash) {
    for (const run of execution.resume.runs.filter(run => run.status === 'PENDING')) {
      await repository.markSkippedRun(run.id, {
        status: 'CANCELLED',
        skippedReason: 'Superseded by a newer content revision',
        message: 'Cancelled: superseded content revision',
        finishedAt: new Date().toISOString(),
        timeoutAt: null,
      } as PluginRunUpdateInput)
      jobStatuses[run.order] = 'CANCELLED'
    }
    await completePipelineAttempt({
      driver,
      repository: attemptRepository,
      pipelineId,
      statuses: jobStatuses,
    })
    return []
  }

  const pendingRuns: PendingRun[] = execution.resume
    ? execution.resume.runs.map(({ id, pluginId, order }) => ({ id, pluginId, order }))
    : []
  if (!execution.resume) for (const { pluginId, edgeData, order } of pluginsToRun) {
    const pluginNode = edgeData.node.Plugin
    const pluginVersionData = edgeData.node
    const ruleSetVersion = createRuleSetVersion({
      pluginId,
      pluginVersion: pluginVersionData.version,
      serverRules,
      forumRules,
    })

    const timing = createQueuedPluginRunTiming()
    const runCreateResult = await repository.createPendingRuns([
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
          targetVersion: contentRevisionHash,
          ruleSetVersion,
          deferred: execution.deferExecution === true,
          pipelineId,
          executionOrder: order,
          queuedAt: timing.queuedAt,
          timeoutAt: timing.timeoutAt,
          payload: JSON.stringify({
            event,
            commentId: comment.id,
            channelUniqueName
          }),
          updatedAt: new Date().toISOString()
        } as PluginRunCreateInput)
      ])

    await cancelSupersededPluginRuns({
      driver,
      repository: leaseRepository,
      currentRun: {
        id: runCreateResult.pluginRuns[0].id,
        pluginId,
        pipelineId,
        scope: 'SERVER',
        channelId: channelUniqueName,
        targetId: comment.id,
        targetType: 'Comment',
        queuedAt: timing.queuedAt,
      },
    })

    pendingRuns.push({
      id: runCreateResult.pluginRuns[0].id,
      pluginId,
      order
    })
  }

  if (execution.deferExecution && !execution.resume) {
    return Promise.all(
      pendingRuns.map(async run => (await repository.findReturnedRun(run.id))[0])
    )
  }

  let executedRuns = 0
  for (let i = 0; i < pluginsToRun.length; i++) {
    const { pluginId, edgeData, step, order } = pluginsToRun[i]
    const pendingRun = pendingRuns.find(r => r.pluginId === pluginId && r.order === order)
    if (!pendingRun) continue

    const pluginRunId = pendingRun.id
    const pluginVersionData = edgeData.node
    const pluginNode = pluginVersionData.Plugin
    const resumedRun = resumedRunsByOrder.get(order)

    if (resumedRun && resumedRun.status !== 'PENDING') {
      if (resumedRun.status === 'RUNNING') break
      if (resumedRun.status === 'SUCCEEDED') previousStatus = 'SUCCEEDED'
      if (resumedRun.status === 'FAILED') {
        previousStatus = 'FAILED'
        if (stopOnFirstFailure && !step.continueOnError) pipelineStopped = true
      }
      if (resumedRun.status === 'TIMED_OUT' || resumedRun.status === 'CANCELLED') {
        previousStatus = 'FAILED'
        if (stopOnFirstFailure && !step.continueOnError) pipelineStopped = true
      }
      continue
    }

    if (
      execution.resume?.maxRuns !== undefined &&
      executedRuns >= execution.resume.maxRuns
    ) {
      break
    }

    const expectedRuleSetVersion = createRuleSetVersion({
      pluginId,
      pluginVersion: pluginVersionData.version,
      serverRules,
      forumRules,
    })
    if (resumedRun?.ruleSetVersion && resumedRun.ruleSetVersion !== expectedRuleSetVersion) {
      await repository.markSkippedRun(pluginRunId, {
        status: 'CANCELLED',
        skippedReason: 'Rules changed after this job was queued',
        message: 'Cancelled: superseded rule set',
        finishedAt: new Date().toISOString(),
        timeoutAt: null,
      } as PluginRunUpdateInput)
      jobStatuses[order] = 'CANCELLED'
      continue
    }

    if (pipelineStopped) {
      await repository.markSkippedRun(pluginRunId, ({
          status: 'SKIPPED',
          skippedReason: 'Pipeline stopped due to previous failure',
          message: 'Skipped: pipeline stopped',
          finishedAt: new Date().toISOString(),
          timeoutAt: null,
        } as PluginRunUpdateInput))
      jobStatuses[order] = 'SKIPPED'

      const skipped = await repository.findReturnedRun(pluginRunId)
      if (skipped[0]) runs.push(skipped[0])
      continue
    }

    if (!shouldRunStep(step, previousStatus)) {
      const reason = step.condition === 'PREVIOUS_SUCCEEDED'
        ? 'Condition not met: previous step did not succeed'
        : 'Condition not met: previous step did not fail'

      await repository.markSkippedRun(pluginRunId, ({
          status: 'SKIPPED',
          skippedReason: reason,
          message: `Skipped: ${reason}`,
          finishedAt: new Date().toISOString(),
          timeoutAt: null,
        } as PluginRunUpdateInput))
      jobStatuses[order] = 'SKIPPED'

      const skipped = await repository.findReturnedRun(pluginRunId)
      if (skipped[0]) runs.push(skipped[0])
      continue
    }

    const lease = await claimPluginRunLease({
      driver,
      repository: leaseRepository,
      pluginRunId,
      pipelineId,
      claimLimits: execution.resume?.claimLimits,
    })
    if (!lease) {
      const unclaimed = await repository.findReturnedRun(pluginRunId)
      const status = unclaimed[0]?.status
      if (
        status === 'PENDING' || status === 'RUNNING' ||
        status === 'SUCCEEDED' || status === 'FAILED' ||
        status === 'SKIPPED' || status === 'TIMED_OUT' ||
        status === 'CANCELLED'
      ) {
        jobStatuses[order] = status
      }
      if (unclaimed[0]) runs.push(unclaimed[0])
      if (execution.resume) break
      continue
    }
    executedRuns += 1

    const heartbeat = startPluginRunHeartbeat({
      driver,
      repository: leaseRepository,
      lease,
    })
    jobStatuses[order] = 'RUNNING'

    const runStart = performance.now()
    const logs: string[] = []
    const flags: unknown[] = []
    let publicDiagnostics: PublicDiagnostic[] = []

    try {
      const tarballUrl = pluginVersionData.tarballGsUri || pluginVersionData.repoUrl
      const PluginClass = await loadPlugin(tarballUrl, pluginVersionData.entryPath || 'dist/index.js')

      const serverSecrets = await repository.findSecrets(pluginId)

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
      const channelPluginState =
        channelPluginStatesByVersionId.get(pluginVersionData.id) ||
        channelPluginStatesByName.get(pluginId) ||
        { enabled: false, settingsJson: null }
      const channelSettingsJsonRaw = channelPluginState.enabled
        ? parseIfString(channelPluginState.settingsJson)
        : {}

      // Channel settings are stored flat but need to be merged into the 'channel' sub-key
      // to match the plugin's expected structure: { server: {...}, channel: {...} }
      const channelSettingsJson = Object.keys(channelSettingsJsonRaw).length > 0
        ? { channel: channelSettingsJsonRaw }
        : {}

      const runtimeSettings = mergeSettings(
        mergeSettings(settingsDefaults, serverSettingsJson),
        channelSettingsJson
      )
      const diagnosticCollector = createPublicDiagnosticCollector({
        secrets: Object.values(decryptedSecrets),
      })
      publicDiagnostics = diagnosticCollector.entries
      const internalLog = (...args: unknown[]) => {
        const message = args
          .map(arg =>
            typeof arg === 'string' ? arg : JSON.stringify(arg)
          )
          .join(' ')
        logs.push(message)
        logger.info(`[Plugin:${pluginId}]`, message)
      }

      const context = {
        scope: 'SERVER' as const,
        channelId: channelUniqueName,
        settings: runtimeSettings,
        secrets: {
          server: decryptedSecrets
        },
        diagnostics: {
          public: diagnosticCollector.public,
        },
        log: Object.assign(internalLog, { internal: internalLog }),
        storeFlag: async (flag: unknown) => {
          flags.push(flag)
        },
        logPromptDebug: createPromptDebugLogger({
          pluginId,
          channelId: channelUniqueName,
          logs
        }),
        createCommentAsBot: async (input: {
          text: string
          botName: string
          profileId?: string | null
          profileLabel?: string | null
          parentCommentId?: string | null
        }) => {
          // Check if the bot is suspended before allowing it to comment
          const botUsername = buildBotUsername(channelUniqueName, input.botName, input.profileId)
          const suspensionInfo = await getSuspension({
            repository: createChannelPermissionRepository(driver),
            channelUniqueName,
            username: botUsername,
          })
          if (suspensionInfo.isSuspended) {
            logs.push(`Bot "${botUsername}" is suspended - action blocked`)
            return null
          }

          return createBotComment({
            driver,
            channelUniqueName,
            text: input.text,
            botName: input.botName,
            profileId: input.profileId || null,
            profileLabel: input.profileLabel || null,
            parentCommentId: input.parentCommentId || null,
            discussionChannelId: comment.DiscussionChannel?.id || null,
            eventId: comment.Event?.id || null
          })
        },
        reportContentAsBot: async (input: {
          contentType: 'comment' | 'discussion' | 'event'
          contentId: string
          reportText: string
          selectedForumRules: string[]
          selectedServerRules: string[]
          botName: string
          profileId?: string | null
          profileLabel?: string | null
        }) => {
          if (!driver) {
            throw new Error('Database driver not available for reportContentAsBot')
          }

          if (!(await isCurrentContentRevision())) {
            logs.push('Report skipped: superseded by a newer content revision')
            return null
          }

          // Check if the bot is suspended before allowing it to report
          const botUsername = buildBotUsername(channelUniqueName, input.botName, input.profileId)
          const suspensionInfo = await getSuspension({
            repository: createChannelPermissionRepository(driver),
            channelUniqueName,
            username: botUsername,
          })
          if (suspensionInfo.isSuspended) {
            logs.push(`Bot "${botUsername}" is suspended - action blocked`)
            return null
          }

          const ruleSetVersion = createRuleSetVersion({
            pluginId,
            pluginVersion: pluginVersionData.version,
            serverRules,
            forumRules,
          })

          return reportAsBot({
            driver,
            channelUniqueName,
            reportInput: input,
            idempotencyKey: createReportIdempotencyKey({
              channelUniqueName,
              contentType: input.contentType,
              contentId: input.contentId,
              contentRevisionHash,
              ruleSetVersion,
              pluginId,
              pluginVersion: pluginVersionData.version,
            }),
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

      const parsedBotMentions = (() => {
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
      })()

      const eventEnvelope = {
        type: event,
        payload: {
          commentId: comment.id,
          commentText: comment.text,
          botMentions: parsedBotMentions,
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
            displayName:
              channel?.displayName ||
              comment.Channel?.displayName ||
              null,
            description:
              channel?.description ||
              comment.Channel?.description ||
              null,
            rules: Array.isArray(channel?.rules) ? channel.rules : []
          },
          parentCommentId: comment.ParentComment?.id || null,
          context: buildBotInvocationContext({
            invocationType:
              event === PLUGIN_EVENTS.COMMENT_EDITED
                ? 'comment-edited'
                : parsedBotMentions.length > 0
                ? 'tagged-comment'
                : 'comment-created',
            server: {
              rules: serverConfig.rules
            },
            channel: {
              uniqueName: channelUniqueName,
              displayName:
                channel?.displayName ||
                comment.Channel?.displayName ||
                null,
              description:
                channel?.description ||
                comment.Channel?.description ||
                null,
              rules: channel?.rules,
              pluginEnabled: channelPluginState.enabled,
            },
            discussion: discussionChannel?.Discussion
              ? {
                  id: discussionChannel.Discussion.id,
                  title: discussionChannel.Discussion.title,
                  body: discussionChannel.Discussion.body
                }
              : null,
            comment,
            parentComments
          })
        }
      }

      const pluginInstance = new PluginClass(context)
      const result = await pluginInstance.handleEvent(eventEnvelope)
      const runEnd = performance.now()
      const durationMs = Math.round(runEnd - runStart)

      const succeeded = result?.success !== false
      previousStatus = succeeded ? 'SUCCEEDED' : 'FAILED'

      await completePluginRunLease({
      driver,
      repository: leaseRepository,
        lease,
        update: {
          status: succeeded ? 'SUCCEEDED' : 'FAILED',
          message: succeeded
            ? (result?.result?.message || 'Plugin run completed')
            : (result?.error || 'Plugin reported failure'),
          durationMs,
          publicDiagnostics: JSON.stringify(publicDiagnostics),
          payload: JSON.stringify({
            event,
            flags,
            logs,
            result
          }),
        },
      })
      jobStatuses[order] = succeeded ? 'SUCCEEDED' : 'FAILED'

      if (!succeeded && stopOnFirstFailure && !step.continueOnError) {
        pipelineStopped = true
      }

      const updated = await repository.findReturnedRun(pluginRunId)

      if (updated[0]) {
        runs.push(updated[0])
      }
    } catch (error) {
      const runEnd = performance.now()
      const durationMs = Math.round(runEnd - runStart)
      const message = (error instanceof Error ? error.message : '') || 'Plugin execution failed'

      previousStatus = 'FAILED'

      await completePluginRunLease({
      driver,
      repository: leaseRepository,
        lease,
        update: {
          status: 'FAILED',
          message,
          durationMs,
          publicDiagnostics: JSON.stringify(publicDiagnostics),
          payload: JSON.stringify({
            event,
            error: message,
            logs,
            flags
          }),
        },
      })
      jobStatuses[order] = 'FAILED'

      const updated = await repository.findReturnedRun(pluginRunId)

      if (updated[0]) {
        runs.push(updated[0])
      }

      if (stopOnFirstFailure && !step.continueOnError) {
        pipelineStopped = true
      }
    } finally {
      heartbeat.stop()
    }
  }

  await completePipelineAttempt({
    driver,
    repository: attemptRepository,
    pipelineId,
    statuses: jobStatuses,
  })

  return runs
}
