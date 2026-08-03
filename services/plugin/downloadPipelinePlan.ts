import type {
  EventPipeline,
  PipelineApplicability,
  PluginEdgeData,
  PluginToRun,
} from './types.js'
import {
  buildPluginVersionMaps,
  getPluginForStep,
  parseManifest,
} from './pipelineUtils.js'

export type DownloadPipelinePlan = {
  event: string
  applicability: PipelineApplicability
  effectiveAt: string | null
  policyId: string | null
  required: boolean
  reason: 'APPLICABLE' | 'UPLOADED_BEFORE_POLICY' | 'NO_APPLICABLE_PLUGINS'
  eventPipeline: EventPipeline | null
  pluginsToRun: PluginToRun[]
}

const DEFAULT_APPLICABILITY: PipelineApplicability = 'ALL_FILES_IMMEDIATE'

const handlesEvent = (edgeData: PluginEdgeData, event: string): boolean => {
  const manifest = parseManifest(edgeData.node.manifest)
  const events = Array.isArray(manifest.events) ? manifest.events : []
  return events.includes(event)
}

const resolveConfiguredSteps = ({
  event,
  eventPipeline,
  pluginVersionsMap,
}: {
  event: string
  eventPipeline: EventPipeline
  pluginVersionsMap: ReturnType<typeof buildPluginVersionMaps>
}): PluginToRun[] => {
  const pluginsToRun: PluginToRun[] = []

  eventPipeline.steps.forEach((step, order) => {
    const pluginMatch = getPluginForStep(
      pluginVersionsMap,
      step.pluginId,
      step.version
    )
    if (!pluginMatch || !handlesEvent(pluginMatch.edgeData, event)) return

    pluginsToRun.push({
      pluginId: step.pluginId,
      edgeData: pluginMatch.edgeData,
      step,
      order,
    })
  })

  return pluginsToRun
}

const uploadedBeforePolicy = ({
  applicability,
  effectiveAt,
  uploadedAt,
}: {
  applicability: PipelineApplicability
  effectiveAt: string | null
  uploadedAt?: string | null
}): boolean => {
  if (applicability !== 'NEW_FILES_ONLY' || !effectiveAt || !uploadedAt) {
    return false
  }

  const effectiveTime = Date.parse(effectiveAt)
  const uploadedTime = Date.parse(uploadedAt)
  return (
    Number.isFinite(effectiveTime) &&
    Number.isFinite(uploadedTime) &&
    uploadedTime < effectiveTime
  )
}

export const resolveDownloadPipelinePlan = ({
  event,
  pipelines,
  installedPluginEdges,
  uploadedAt,
}: {
  event: string
  pipelines: EventPipeline[]
  installedPluginEdges: PluginEdgeData[]
  uploadedAt?: string | null
}): DownloadPipelinePlan => {
  const eventPipeline = pipelines.find(pipeline => pipeline.event === event) || null
  const applicability =
    eventPipeline?.applicability || DEFAULT_APPLICABILITY
  const effectiveAt = eventPipeline?.effectiveAt || null
  const pluginVersionsMap = buildPluginVersionMaps(installedPluginEdges)
  // Enabling a plugin makes it available to pipeline editors. It must not
  // silently opt every channel into every event declared by its manifest.
  // Only an explicitly configured event pipeline is executable/required.
  const pluginsToRun = eventPipeline
    ? resolveConfiguredSteps({ event, eventPipeline, pluginVersionsMap })
    : []

  if (
    uploadedBeforePolicy({
      applicability,
      effectiveAt,
      uploadedAt,
    })
  ) {
    return {
      event,
      applicability,
      effectiveAt,
      policyId: eventPipeline?.policyId || null,
      required: false,
      reason: 'UPLOADED_BEFORE_POLICY',
      eventPipeline,
      pluginsToRun,
    }
  }

  return {
    event,
    applicability,
    effectiveAt,
    policyId: eventPipeline?.policyId || null,
    required: pluginsToRun.length > 0,
    reason: pluginsToRun.length > 0 ? 'APPLICABLE' : 'NO_APPLICABLE_PLUGINS',
    eventPipeline,
    pluginsToRun,
  }
}
