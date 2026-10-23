import type { EventPipeline } from './types.js'

type StoredPipelineStep = {
  pluginId: string
  version: string
  order: number
  condition: 'ALWAYS' | 'PREVIOUS_SUCCEEDED' | 'PREVIOUS_FAILED'
  continueOnError: boolean
}

const STEP_CONDITIONS = new Set<StoredPipelineStep['condition']>([
  'ALWAYS',
  'PREVIOUS_SUCCEEDED',
  'PREVIOUS_FAILED',
])

export type StoredPipelineConfiguration = {
  event: string
  stopOnFirstFailure: boolean
  steps: StoredPipelineStep[]
}

export const parseStoredPipelineConfiguration = (
  value: unknown
): StoredPipelineConfiguration | null => {
  let parsed = value
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      return null
    }
  }
  if (!parsed || typeof parsed !== 'object') return null

  const candidate = parsed as Partial<StoredPipelineConfiguration>
  if (typeof candidate.event !== 'string' || !Array.isArray(candidate.steps)) {
    return null
  }

  const steps = candidate.steps.filter((step): step is StoredPipelineStep =>
    Boolean(
      step &&
      typeof step.pluginId === 'string' &&
      typeof step.version === 'string' &&
      Number.isInteger(step.order) &&
      STEP_CONDITIONS.has(step.condition) &&
      typeof step.continueOnError === 'boolean'
    )
  )

  if (steps.length !== candidate.steps.length) return null

  return {
    event: candidate.event,
    stopOnFirstFailure: candidate.stopOnFirstFailure !== false,
    steps: [...steps].sort((left, right) => left.order - right.order),
  }
}

export const pipelineFromStoredConfiguration = (
  configuration: StoredPipelineConfiguration
): EventPipeline => ({
  event: configuration.event,
  stopOnFirstFailure: configuration.stopOnFirstFailure,
  steps: configuration.steps.map(step => ({
    pluginId: step.pluginId,
    version: step.version,
    condition: step.condition || 'ALWAYS',
    continueOnError: step.continueOnError === true,
  })),
})
