import { performance } from 'perf_hooks'
import { Storage } from '@google-cloud/storage'
import type {
  TriggerArgs,
  PluginEdgeData,
  EventPipeline,
  PendingRun,
  PipelineExecutionMetadata,
} from './types.js'
import { DOWNLOAD_EVENTS } from './constants.js'
import { decryptSecret } from './encryption.js'
import { loadPluginImplementation } from './pluginLoader.js'
import { generatePipelineId, shouldRunStep, mergeSettings, getAttachmentUrls } from './pipelineUtils.js'
import { resolveDownloadPipelinePlan } from './downloadPipelinePlan.js'
import {
  completePipelineAttempt,
  createPipelineAttempt,
  type PipelineJobStatus,
} from './pipelineAttempt.js'
import {
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
  type DownloadScanOutcome
} from './downloadScanOutcome.js'
import { createDownloadReadUrl } from '../downloadStorage.js'
import type { PluginRunCreateInput, PluginRunUpdateInput, DownloadableFile as DownloadableFileType, DownloadableFileUpdateInput, ServerConfig as ServerConfigType, Discussion as DiscussionType } from '../../ogm_types.js'
import { logger } from "../../logger.js";
import { notifyUploaderOfPipelineResult } from "./pipelineNotifications.js";

export const isSupportedEvent = (event: string) => DOWNLOAD_EVENTS.has(event)

export const triggerPluginRunsForDownloadableFile = async (
  {
    downloadableFileId,
    event,
    models
  }: TriggerArgs,
  // Injectable plugin loader so the execution path can be tested without
  // downloading/running a real plugin tarball. Defaults to the real loader.
  {
    loadPlugin = loadPluginImplementation,
    storage = new Storage(),
    execution,
  }: {
    loadPlugin?: typeof loadPluginImplementation
    storage?: Pick<Storage, 'bucket'>
    execution?: PipelineExecutionMetadata
  } = {}
) => {
  if (!DOWNLOAD_EVENTS.has(event)) {
    throw new Error(`Unsupported plugin event: ${event}`)
  }

  const {
    DownloadableFile,
    PluginPipelineRun,
    PluginRun,
    ServerConfig,
    ServerSecret,
    User,
  } = models

  const files = await DownloadableFile.find({
    where: { id: downloadableFileId },
    selectionSet: `{
      id
      fileName
      url
      kind
      size
      uploadedAt
      createdAt
      storageBucket
      storageObjectName
      Discussion {
        id
        title
        body
        DiscussionChannels {
          channelUniqueName
          Channel {
            uniqueName
            displayName
            description
            rules
          }
        }
      }
    }`
  })

  if (!files.length) {
    throw new Error('Downloadable file not found')
  }

  const downloadableFile = files[0]
  // The runtime schema exposes a singular `Discussion` on DownloadableFile that
  // the generated DownloadableFile type doesn't model yet, so extend the
  // generated type with that queried field.
  const fileData = downloadableFile as DownloadableFileType & {
    storageBucket?: string | null
    storageObjectName?: string | null
    Discussion?: DiscussionType | null
  }
  const discussionChannel = fileData.Discussion?.DiscussionChannels?.[0] || null
  const channelId = discussionChannel?.channelUniqueName || null
  const channelNode = discussionChannel?.Channel || null

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

  const serverConfig: ServerConfigType | undefined = serverConfigs[0]
  if (!serverConfig) {
    return []
  }

  const edges = serverConfig.InstalledVersionsConnection?.edges || []

  const pipelines: EventPipeline[] = serverConfig.pluginPipelines || []
  const plan = resolveDownloadPipelinePlan({
    event,
    pipelines,
    installedPluginEdges: edges as unknown as PluginEdgeData[],
    uploadedAt: fileData.uploadedAt || fileData.createdAt,
  })
  const { eventPipeline, pluginsToRun } = plan

  // Generate unique pipeline ID
  const pipelineId = execution?.pipelineId || generatePipelineId()

  if (!plan.required || pluginsToRun.length === 0) {
    return []
  }

  await createPipelineAttempt({
    PluginPipelineRun,
    context: {
      pipelineId,
      targetId: downloadableFile.id,
      targetType: 'DownloadableFile',
      targetVersion: fileData.uploadedAt || fileData.createdAt || null,
      eventType: event,
      scope: 'SERVER',
      channelId,
      applicability: plan.applicability,
      policyEffectiveAt: plan.effectiveAt,
      policyId: execution?.policyId || plan.policyId,
      campaignId: execution?.campaignId,
      eventPipeline,
      pluginsToRun,
      trigger: execution?.trigger,
      initiatedByUsername: execution?.initiatedByUsername,
      retryOfPipelineRunId: execution?.retryOfPipelineRunId,
    },
  })

  const securityScanExpected = pluginsToRun.some(
    plugin => plugin.pluginId === SECURITY_SCAN_PLUGIN_ID
  )
  let securityScanOutcome: DownloadScanOutcome | null = null

  // Replacements can arrive while the previous version is CLEAN. Hold the
  // file before starting the scanner so that old approval cannot make new
  // bytes publicly downloadable during the rescan window.
  if (securityScanExpected && event !== 'downloadableFile.downloaded') {
    await DownloadableFile.update({
      where: { id: downloadableFileId },
      update: ({
        scanStatus: 'PENDING',
        scanReason: null,
        scanCheckedAt: null,
        reviewRequestedAt: null,
        reviewRequestReason: null,
        reviewRequestedByUsername: null
      } as DownloadableFileUpdateInput)
    })
  }

  const runs: unknown[] = []
  const jobStatuses: PipelineJobStatus[] = pluginsToRun.map(() => 'PENDING')
  const stopOnFirstFailure = eventPipeline?.stopOnFirstFailure ?? true
  let previousStatus: 'SUCCEEDED' | 'FAILED' | null = null
  let pipelineStopped = false
  let attachmentPromise: Promise<string[]> | null = null
  const getPluginAttachments = (): Promise<string[]> => {
    if (!attachmentPromise) {
      attachmentPromise = createDownloadReadUrl({
        file: fileData,
        storage
      }).then(url => url ? [url] : [])
    }
    return attachmentPromise
  }

  // Create PENDING records for all plugins first (for UI visibility)
  const pendingRuns: PendingRun[] = []
  for (const { pluginId, edgeData, order } of pluginsToRun) {
    const pluginNode = edgeData.node.Plugin
    const pluginVersionData = edgeData.node

    const timing = createQueuedPluginRunTiming()
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
          queuedAt: timing.queuedAt,
          timeoutAt: timing.timeoutAt,
          payload: JSON.stringify({
            fileName: fileData.fileName,
            url: fileData.url,
            event
          }),
          updatedAt: new Date().toISOString()
        } as unknown as PluginRunCreateInput)
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
          message: 'Skipped: pipeline stopped',
          finishedAt: new Date().toISOString(),
          timeoutAt: null,
        } as PluginRunUpdateInput)
      })
      jobStatuses[order] = 'SKIPPED'

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
          message: `Skipped: ${reason}`,
          finishedAt: new Date().toISOString(),
          timeoutAt: null,
        } as PluginRunUpdateInput)
      })
      jobStatuses[order] = 'SKIPPED'

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

    const lease = await claimPluginRunLease({
      PluginRun,
      PluginPipelineRun,
      pluginRunId,
      pipelineId,
    })
    if (!lease) continue

    const heartbeat = startPluginRunHeartbeat({
      PluginRun,
      PluginPipelineRun,
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

      // settingsJson / settingsDefaults may be stored as JSON strings; parse
      // them before merging so plugin settings resolve to real keys instead of
      // string character indices.
      const parseMaybeJson = (value: unknown): Record<string, unknown> => {
        if (typeof value === 'string') {
          try {
            return JSON.parse(value) as Record<string, unknown>
          } catch {
            return {}
          }
        }
        return value && typeof value === 'object'
          ? (value as Record<string, unknown>)
          : {}
      }
      const settingsDefaults = parseMaybeJson(pluginVersionData.settingsDefaults)
      const settingsJson = parseMaybeJson(edgeData.properties?.settingsJson)
      const runtimeSettings = mergeSettings(settingsDefaults, settingsJson)
      const attachments = await getPluginAttachments()
      const storedAttachments = getAttachmentUrls(downloadableFile)
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
        channelId,
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
          channelId,
          logs
        })
      }

      const pluginInstance = new PluginClass(context)
      const eventEnvelope = {
        type: event,
        payload: {
          discussionId: fileData.Discussion?.id,
          attachmentUrls: attachments,
          downloadableFileId: fileData.id,
          context: buildBotInvocationContext({
            invocationType: 'downloadable-file-created',
            channel: {
              uniqueName: channelNode?.uniqueName || channelId,
              displayName: channelNode?.displayName || channelId,
              description: channelNode?.description,
              rules: channelNode?.rules
            },
            discussion: fileData.Discussion?.id
              ? {
                  id: fileData.Discussion.id,
                  title: fileData.Discussion.title,
                  body: fileData.Discussion.body
                }
              : null
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
        PluginRun,
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
            attachments: storedAttachments,
            attachmentCount: attachments.length,
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

      if (pluginId === SECURITY_SCAN_PLUGIN_ID) {
        securityScanOutcome = failedDownloadScanOutcome(message)
      }

      previousStatus = 'FAILED'

      await completePluginRunLease({
        PluginRun,
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
    } finally {
      heartbeat.stop()
    }
  }

  if (securityScanExpected) {
    const outcome = securityScanOutcome || failedDownloadScanOutcome(
      'The security scan was skipped before it could complete.'
    )
    await DownloadableFile.update({
      where: { id: downloadableFileId },
      update: ({
        scanStatus: outcome.status,
        scanReason: outcome.reason,
        scanCheckedAt: new Date().toISOString()
      } as DownloadableFileUpdateInput)
    })
  }

  await completePipelineAttempt({
    PluginPipelineRun,
    pipelineId,
    statuses: jobStatuses,
  })
  await notifyUploaderOfPipelineResult({
    DownloadableFile,
    PluginPipelineRun,
    User,
    pipelineId,
  })

  return runs
}
