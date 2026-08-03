import { randomUUID } from 'node:crypto'
import { DOWNLOAD_EVENTS } from './constants.js'
import {
  buildPluginVersionMaps,
  parseManifest,
  parseStoredPipelines,
} from './pipelineUtils.js'
import type { EventPipeline, PluginEdgeData } from './types.js'

export const materializeLegacyDownloadPipelines = ({
  storedPipelines,
  installedPluginEdges,
  effectiveAt = new Date().toISOString(),
  createPolicyId = randomUUID,
}: {
  storedPipelines: unknown
  installedPluginEdges: PluginEdgeData[]
  effectiveAt?: string
  createPolicyId?: () => string
}) => {
  const pipelines = parseStoredPipelines(storedPipelines)
  const configuredEvents = new Set(pipelines.map(pipeline => pipeline.event))
  const versions = buildPluginVersionMaps(installedPluginEdges)
  const additions: EventPipeline[] = []

  for (const event of DOWNLOAD_EVENTS) {
    if (configuredEvents.has(event)) continue

    const steps = [...versions.entries()]
      .filter(([, pluginVersions]) => {
        const latest = pluginVersions[0]
        if (!latest) return false
        const manifest = parseManifest(latest.edgeData.node.manifest)
        return Array.isArray(manifest.events) && manifest.events.includes(event)
      })
      .map(([pluginId]) => ({
        pluginId,
        condition: 'ALWAYS' as const,
        continueOnError: false,
      }))

    if (steps.length === 0) continue
    additions.push({
      event,
      steps,
      stopOnFirstFailure: true,
      applicability: 'ALL_FILES_IMMEDIATE',
      effectiveAt,
      policyId: createPolicyId(),
    })
  }

  return {
    pipelines: [...pipelines, ...additions],
    addedEvents: additions.map(pipeline => pipeline.event),
  }
}
