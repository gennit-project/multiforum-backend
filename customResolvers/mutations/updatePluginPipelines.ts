import type { ServerConfigModel } from '../../ogm_types.js'

type Input = {
  ServerConfig: ServerConfigModel
}

export type PipelineStepInput = {
  pluginId: string
  version?: string
  continueOnError?: boolean
  condition?: 'ALWAYS' | 'PREVIOUS_SUCCEEDED' | 'PREVIOUS_FAILED'
}

export type EventPipelineInput = {
  event: string
  steps: PipelineStepInput[]
  stopOnFirstFailure?: boolean
  effectiveAt?: string
  applicability?: 'NEW_FILES_ONLY' | 'ALL_FILES_GRADUAL' | 'ALL_FILES_IMMEDIATE'
}

type Args = {
  pipelines: EventPipelineInput[]
}

export const normalizePipelinesForStorage = (
  pipelines: EventPipelineInput[],
  effectiveAt = new Date().toISOString()
): EventPipelineInput[] =>
  pipelines.map(pipeline => {
    if (!pipeline.event.startsWith('downloadableFile.')) return pipeline
    return {
      ...pipeline,
      applicability: pipeline.applicability || 'NEW_FILES_ONLY',
      effectiveAt: pipeline.effectiveAt || effectiveAt,
    }
  })

/**
 * Validates pipeline configuration structure.
 * Returns null if valid, or an error message string if invalid.
 */
export const validatePipelines = (pipelines: EventPipelineInput[]): string | null => {
  for (const pipeline of pipelines) {
    if (!pipeline.event) {
      return 'Invalid pipeline: each pipeline must have an event'
    }
    if (!pipeline.steps || pipeline.steps.length === 0) {
      return 'Invalid pipeline: each pipeline must have at least one step'
    }
    if (
      pipeline.applicability &&
      ![
        'NEW_FILES_ONLY',
        'ALL_FILES_GRADUAL',
        'ALL_FILES_IMMEDIATE',
      ].includes(pipeline.applicability)
    ) {
      return `Invalid pipeline applicability: ${pipeline.applicability}`
    }
    if (
      pipeline.effectiveAt &&
      !Number.isFinite(Date.parse(pipeline.effectiveAt))
    ) {
      return `Invalid pipeline effectiveAt: ${pipeline.effectiveAt}`
    }
    for (const step of pipeline.steps) {
      if (!step.pluginId) {
        return 'Invalid step: each step must have a pluginId'
      }
      // Validate condition if provided
      if (step.condition && !['ALWAYS', 'PREVIOUS_SUCCEEDED', 'PREVIOUS_FAILED'].includes(step.condition)) {
        return `Invalid step condition: ${step.condition}. Must be ALWAYS, PREVIOUS_SUCCEEDED, or PREVIOUS_FAILED`
      }
    }
  }
  return null
}

const getResolver = (input: Input) => {
  const { ServerConfig } = input

  return async (_parent: unknown, args: Args, _context: unknown, _resolveInfo: unknown) => {
    const { pipelines } = args

    // Validate pipelines structure
    const validationError = validatePipelines(pipelines)
    if (validationError) {
      throw new Error(validationError)
    }

    // Get server config
    const existingConfigs = await ServerConfig.find({
      selectionSet: `{ serverName pluginPipelines }`
    })

    if (existingConfigs.length === 0) {
      throw new Error('No server config found')
    }

    const serverConfig = existingConfigs[0]

    const normalizedPipelines = normalizePipelinesForStorage(pipelines)

    // Update the pluginPipelines JSON field (serialized as string for Neo4j)
    await ServerConfig.update({
      where: { serverName: serverConfig.serverName },
      update: {
        pluginPipelines: JSON.stringify(normalizedPipelines)
      }
    })

    return normalizedPipelines
  }
}

export default getResolver
