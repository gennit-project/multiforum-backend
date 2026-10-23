import {createChannelExecutionRepository, type ChannelExecutionRepository} from "../persistence/channelExecutionRepository.js";
import type { PipelineAttemptRepository } from "../persistence/pipelineAttemptRepository.js";
import type { PipelineLeaseRepository } from "../persistence/pipelineLeaseRepository.js";
import { performance } from 'perf_hooks'
import type {
  ChannelTriggerArgs,
  PluginEdgeData,
  EventPipeline,
  PluginToRun,
  PendingRun,
  PipelineExecutionMetadata,
  EventTriggerExecutionOptions,
} from './types.js'
import { CHANNEL_EVENTS } from './constants.js'
import { decryptSecret } from './encryption.js'
import { loadPluginImplementation } from './pluginLoader.js'
import {
  generatePipelineId,
  shouldRunStep,
  mergeSettings,
  buildPluginVersionMaps,
  getPluginForStep,
  parseManifest,
  parseStoredPipelines,
} from './pipelineUtils.js'
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
import { buildBotInvocationContext } from './buildBotInvocationContext.js'
import { createPromptDebugLogger } from './promptDebug.js'
import {
  SECURITY_SCAN_PLUGIN_ID,
  failedDownloadScanOutcome,
  resolveDownloadScanOutcome,
  type DownloadScanOutcome,
} from './downloadScanOutcome.js'
import { createDownloadReadUrl } from '../downloadStorage.js'
import { createBotReport } from '../botReportService.js'
import { buildBotUsername } from '../botUserService.js'
import { getActiveSuspension } from '../../rules/permission/getActiveSuspension.js'
import { createChannelPermissionRepository } from '../persistence/channelPermissionRepository.js'
import type { PluginRunCreateInput, PluginRunUpdateInput, DownloadableFileUpdateInput, Channel, Discussion, DownloadableFile, ServerConfig } from '../../ogm_types.js'
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

export const isChannelEvent = (event: string) => CHANNEL_EVENTS.has(event)

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

/**
 * Triggers channel-scoped plugin pipelines when content is submitted to a channel.
 * This runs plugins configured in the Channel's pluginPipelines field.
 */
export const triggerChannelPluginPipeline = async (
  {
    discussionId,
    channelUniqueName,
    event,
    driver,
  }: ChannelTriggerArgs,
  // Injectable plugin loader so the execution path can be tested without
  // downloading/running a real plugin tarball. Defaults to the real loader.
  {
    loadPlugin = loadPluginImplementation,
    execution,
    leaseRepository,
    attemptRepository,
    channelRepository,
    getSuspension = getActiveSuspension,
    reportAsBot = createBotReport,
  }: {
    loadPlugin?: typeof loadPluginImplementation
    execution?: PipelineExecutionMetadata & EventTriggerExecutionOptions
    leaseRepository?: PipelineLeaseRepository
    attemptRepository?: PipelineAttemptRepository
    channelRepository?: ChannelExecutionRepository
    getSuspension?: typeof getActiveSuspension
    reportAsBot?: typeof createBotReport
  } = {}
) => {
  if (!CHANNEL_EVENTS.has(event)) {
    throw new Error(`Unsupported channel plugin event: ${event}`)
  }

  const repository = channelRepository ?? createChannelExecutionRepository(driver!)

  // Get the channel with its pipeline configuration and enabled plugins (for channel-level settings)
  const channels = await repository.findChannel(channelUniqueName)

  if (!channels.length) {
    throw new Error(`Channel "${channelUniqueName}" not found`)
  }

  const channel: Channel = channels[0]
  const channelPipelines = parseStoredPipelines(channel.pluginPipelines)
  const channelEventPipeline = channelPipelines.find(p => p.event === event)

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

  // Get the discussion with its downloadable file
  const discussions = await repository.findDiscussion(discussionId)

  if (!discussions.length) {
    throw new Error(`Discussion "${discussionId}" not found`)
  }

  // Discussion creation permits one attached download. Read the first item from
  // the schema's plural relationship while retaining the legacy singular fixture
  // shape used by a few isolated unit tests.
  const discussion = discussions[0] as Discussion & {
    DownloadableFile?: DownloadableFile | null
  }
  const downloadableFile =
    discussion.DownloadableFiles?.[0] || discussion.DownloadableFile

  // Get server config for enabled plugins (channels can only use server-enabled plugins)
  const serverConfigs = await repository.findConfiguration()

  const serverConfig: ServerConfig | undefined = serverConfigs[0]
  if (!serverConfig) {
    return []
  }

  const edges = serverConfig.InstalledVersionsConnection?.edges || []
  const serverPipelines = parseStoredPipelines(serverConfig.pluginPipelines)
  const serverEventPipeline = serverPipelines.find(p => p.event === event)
  const serverUploadPipeline = serverPipelines.find(
    pipeline => pipeline.event === 'downloadableFile.created'
  )
  const serverSecurityRequired = Boolean(
    serverUploadPipeline?.steps.some(
      step => step.pluginId === SECURITY_SCAN_PLUGIN_ID
    )
  )

  // Build version-aware plugin map (pluginName -> sorted array of versions).
  // The generated relationship edge type is cast to the plugin layer's
  // structurally-compatible PluginEdgeData at this consumer boundary.
  const pluginVersionsMap = buildPluginVersionMaps(
    edges as unknown as PluginEdgeData[]
  )
  const storedConfiguration = execution?.resume
    ? parseStoredPipelineConfiguration(execution.resume.configurationSnapshot)
    : null
  if (execution?.resume && !storedConfiguration) {
    throw new Error(`Queued pipeline "${execution.resume.pipelineId}" has an invalid configuration snapshot`)
  }
  if (storedConfiguration?.event !== undefined && storedConfiguration.event !== event) {
    throw new Error(`Queued pipeline event "${storedConfiguration.event}" does not match "${event}"`)
  }

  // Server-wide candidates establish the baseline. Channel candidates can
  // override a server-selected version of the same plugin, but each plugin is
  // executed at most once for a discussion in a given channel.
  const pluginsById = new Map<string, Omit<PluginToRun, 'order'>>()
  const pluginOrder: string[] = []
  const addPipelineSteps = (
    pipeline: EventPipeline | undefined,
    replaceExisting: boolean
  ) => {
    for (const step of pipeline?.steps || []) {
      if (step.pluginId === SECURITY_SCAN_PLUGIN_ID && !downloadableFile) {
        continue
      }
      if (
        step.pluginId === SECURITY_SCAN_PLUGIN_ID &&
        serverSecurityRequired
      ) {
        continue
      }
      const pluginMatch = getPluginForStep(
        pluginVersionsMap,
        step.pluginId,
        step.version
      )
      if (!pluginMatch) continue
      const manifest = parseManifest(pluginMatch.edgeData.node.manifest)
      const manifestEvents = Array.isArray(manifest.events) ? manifest.events : []
      if (!manifestEvents.includes(event)) continue
      if (!pluginsById.has(step.pluginId)) {
        pluginOrder.push(step.pluginId)
      }
      if (replaceExisting || !pluginsById.has(step.pluginId)) {
        pluginsById.set(step.pluginId, {
          pluginId: step.pluginId,
          edgeData: pluginMatch.edgeData,
          step,
        })
      }
    }
  }

  if (serverEventPipeline) {
    addPipelineSteps(serverEventPipeline, false)
  } else {
    for (const [pluginId, versions] of pluginVersionsMap) {
      const latestVersion = versions[0]
      if (!latestVersion) continue
      if (
        pluginId === SECURITY_SCAN_PLUGIN_ID &&
        (!downloadableFile || serverSecurityRequired)
      ) continue
      const manifest = parseManifest(latestVersion.edgeData.node.manifest)
      const manifestEvents = Array.isArray(manifest.events) ? manifest.events : []
      if (!manifestEvents.includes(event)) continue
      pluginOrder.push(pluginId)
      pluginsById.set(pluginId, {
        pluginId,
        edgeData: latestVersion.edgeData,
        step: { pluginId, condition: 'ALWAYS', continueOnError: false },
      })
    }
  }
  addPipelineSteps(channelEventPipeline, true)

  let pluginsToRun: PluginToRun[] = pluginOrder.map((pluginId, order) => ({
    ...pluginsById.get(pluginId)!,
    order,
  }))

  if (storedConfiguration) {
    const storedPipeline = pipelineFromStoredConfiguration(storedConfiguration)
    pluginsToRun = storedConfiguration.steps.flatMap((storedStep, index) => {
      const step = storedPipeline.steps[index]
      const pluginMatch = getPluginForStep(
        pluginVersionsMap,
        storedStep.pluginId,
        storedStep.version
      )
      if (!pluginMatch) return []
      return [{
        pluginId: storedStep.pluginId,
        edgeData: pluginMatch.edgeData,
        step,
        order: storedStep.order,
      }]
    })
    if (pluginsToRun.length !== storedConfiguration.steps.length) {
      throw new Error(`Queued pipeline "${execution?.resume?.pipelineId}" references an unavailable plugin version`)
    }
  }

  if (pluginsToRun.length === 0) {
    return []
  }

  const contentRevisionHash = createContentRevisionHash({
    channelUniqueName,
    contentId: discussion.id,
    contentType: 'Discussion',
    title: discussion.title,
    body: discussion.body,
    attachmentVersion:
      downloadableFile?.uploadedAt || downloadableFile?.createdAt || null,
  })
  const isCurrentContentRevision = async () => {
    const currentDiscussions = await repository.findDiscussion(discussionId)
    if (!currentDiscussions.length) return false
    const currentDiscussion = currentDiscussions[0] as Discussion & {
      DownloadableFile?: DownloadableFile | null
    }
    const currentFile =
      currentDiscussion.DownloadableFiles?.[0] || currentDiscussion.DownloadableFile
    return createContentRevisionHash({
      channelUniqueName,
      contentId: currentDiscussion.id,
      contentType: 'Discussion',
      title: currentDiscussion.title,
      body: currentDiscussion.body,
      attachmentVersion: currentFile?.uploadedAt || currentFile?.createdAt || null,
    }) === contentRevisionHash
  }
  const serverRules = Array.isArray(serverConfig.rules) ? serverConfig.rules : []
  const forumRules = Array.isArray(channel.rules) ? channel.rules : []

  const pipelineId = execution?.resume?.pipelineId || execution?.pipelineId || generatePipelineId()
  const runs: unknown[] = []
  const resumedRunsByOrder = new Map(
    (execution?.resume?.runs || []).map(run => [run.order, run])
  )
  const jobStatuses: PipelineJobStatus[] = pluginsToRun.map(({ order }) => {
    const status = resumedRunsByOrder.get(order)?.status
    return isPipelineJobStatus(status) ? status : 'PENDING'
  })
  const stopOnFirstFailure =
    storedConfiguration?.stopOnFirstFailure ??
    channelEventPipeline?.stopOnFirstFailure ??
    serverEventPipeline?.stopOnFirstFailure ??
    true
  const eventPipeline: EventPipeline = {
    event,
    steps: pluginsToRun.map(plugin => plugin.step),
    stopOnFirstFailure,
  }
  const securityScanExpected = pluginsToRun.some(
    plugin => plugin.pluginId === SECURITY_SCAN_PLUGIN_ID
  )
  let securityScanOutcome: DownloadScanOutcome | null = null

  if (securityScanExpected && downloadableFile) {
    await repository.writeScanState(downloadableFile.id, ({
        scanStatus: 'PENDING',
        scanReason: null,
        scanCheckedAt: null,
      } as DownloadableFileUpdateInput))
  }
  let previousStatus: 'SUCCEEDED' | 'FAILED' | null = null
  let pipelineStopped = false

  if (!execution?.resume) {
    await createPipelineAttempt({
      driver,
      repository: attemptRepository,
      startImmediately: !execution?.deferExecution,
      context: {
      pipelineId,
      targetId: discussionId,
      targetType: 'Discussion',
      targetVersion: contentRevisionHash,
      eventType: event,
      scope: 'CHANNEL',
      channelId: channelUniqueName,
      eventPipeline,
      pluginsToRun,
      trigger: execution?.trigger,
      initiatedByUsername: execution?.initiatedByUsername,
      retryOfPipelineRunId: execution?.retryOfPipelineRunId,
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

  // Create PENDING records for all plugins first
  const pendingRuns: PendingRun[] = execution?.resume
    ? execution.resume.runs.map(({ id, pluginId, order }) => ({ id, pluginId, order }))
    : []
  if (!execution?.resume) for (const { pluginId, edgeData, order } of pluginsToRun) {
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
          scope: 'CHANNEL',
          channelId: channelUniqueName,
          eventType: event,
          status: 'PENDING',
          targetId: discussionId,
          targetType: 'Discussion',
          targetVersion: contentRevisionHash,
          ruleSetVersion,
          deferred: execution?.deferExecution === true,
          pipelineId,
          executionOrder: order,
          queuedAt: timing.queuedAt,
          timeoutAt: timing.timeoutAt,
          payload: JSON.stringify({
            discussionId,
            channelUniqueName,
            fileName: downloadableFile?.fileName || null,
            event
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
        scope: 'CHANNEL',
        channelId: channelUniqueName,
        targetId: discussionId,
        targetType: 'Discussion',
        queuedAt: timing.queuedAt,
      },
    })

    pendingRuns.push({
      id: runCreateResult.pluginRuns[0].id,
      pluginId,
      order
    })
  }

  if (execution?.deferExecution && !execution.resume) {
    return Promise.all(
      pendingRuns.map(async run => (await repository.findReturnedRun(run.id))[0])
    )
  }

  // Execute each plugin in order
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
      execution?.resume?.maxRuns !== undefined &&
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

    // Check if pipeline was stopped
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

    // Check step condition
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
      claimLimits: execution?.resume?.claimLimits,
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
      if (execution?.resume) break
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
        logger.info(
          `[Plugin:${pluginId}:${channelUniqueName}]`,
          message
        )
      }

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

          const botUsername = buildBotUsername(
            channelUniqueName,
            input.botName,
            input.profileId
          )
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

      const pluginInstance = new PluginClass(context)
      const attachmentUrl = downloadableFile
        ? await createDownloadReadUrl({ file: downloadableFile })
        : null
      const eventEnvelope = {
        type: event,
        payload: {
          discussionId: discussion.id,
          discussionTitle: discussion.title,
          discussionBody: discussion.body,
          author: discussion.Author
            ? {
                username: discussion.Author.username,
                isBot: discussion.Author.isBot || false,
              }
            : null,
          downloadableFileId: downloadableFile?.id || null,
          fileName: downloadableFile?.fileName || null,
          fileSize: downloadableFile?.size || null,
          fileUrl: downloadableFile?.url || null,
          attachmentUrls: attachmentUrl ? [attachmentUrl] : [],
          channel: channelContext,
          context: buildBotInvocationContext({
            invocationType: 'discussion-created',
            server: {
              rules: serverConfig.rules,
            },
            channel: {
              uniqueName: channel.uniqueName,
              displayName: channel.displayName,
              description: channel.description,
              rules: channel.rules,
              pluginEnabled: channelPluginState.enabled,
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
      if (pluginId === SECURITY_SCAN_PLUGIN_ID) {
        securityScanOutcome = resolveDownloadScanOutcome(result)
      }
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
            channel: channelContext,
            flags,
            logs,
            result
          }),
        },
      })
      jobStatuses[order] = succeeded ? 'SUCCEEDED' : 'FAILED'

      // Check if we should stop the pipeline
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

      if (pluginId === SECURITY_SCAN_PLUGIN_ID) {
        securityScanOutcome = failedDownloadScanOutcome(message)
      }

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

      // Check if we should stop the pipeline
      if (stopOnFirstFailure && !step.continueOnError) {
        pipelineStopped = true
      }

      const updated = await repository.findReturnedRun(pluginRunId)

      if (updated[0]) {
        runs.push(updated[0])
      }
    } finally {
      heartbeat.stop()
    }
  }

  if (
    securityScanExpected &&
    downloadableFile &&
    !jobStatuses.some(status => status === 'PENDING' || status === 'RUNNING')
  ) {
    const outcome = securityScanOutcome || failedDownloadScanOutcome(
      'The security scan was skipped before it could complete.'
    )
    await repository.writeScanState(downloadableFile.id, ({
        scanStatus: outcome.status,
        scanReason: outcome.reason,
        scanCheckedAt: new Date().toISOString(),
      } as DownloadableFileUpdateInput))
  }

  await completePipelineAttempt({
    driver,
    repository: attemptRepository,
    pipelineId,
    statuses: jobStatuses,
  })

  return runs
}
