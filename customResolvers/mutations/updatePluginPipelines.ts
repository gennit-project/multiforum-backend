import type { ServerConfigModel } from '../../ogm_types.js'

type Input = {
  ServerConfig: ServerConfigModel
}

export type PipelineStepInput = {
  pluginId: string
  continueOnError?: boolean
  condition?: 'ALWAYS' | 'PREVIOUS_SUCCEEDED' | 'PREVIOUS_FAILED'
}

export type EventPipelineInput = {
  event: string
  steps: PipelineStepInput[]
  stopOnFirstFailure?: boolean
}

type Args = {
  pipelines: EventPipelineInput[]
}

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

    // Update the pluginPipelines JSON field (serialized as string for Neo4j)
    await ServerConfig.update({
      where: { serverName: serverConfig.serverName },
      update: {
        pluginPipelines: JSON.stringify(pipelines)
      }
    })

    return pipelines
  }
}

export default getResolver
