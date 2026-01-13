import type { ServerConfigModel } from '../../ogm_types.js'

type Input = {
  ServerConfig: ServerConfigModel
}

type PipelineStepInput = {
  pluginId: string
  continueOnError?: boolean
  condition?: 'ALWAYS' | 'PREVIOUS_SUCCEEDED' | 'PREVIOUS_FAILED'
}

type EventPipelineInput = {
  event: string
  steps: PipelineStepInput[]
  stopOnFirstFailure?: boolean
}

type Args = {
  pipelines: EventPipelineInput[]
}

const getResolver = (input: Input) => {
  const { ServerConfig } = input

  return async (_parent: unknown, args: Args, _context: unknown, _resolveInfo: unknown) => {
    const { pipelines } = args

    // Validate pipelines structure
    for (const pipeline of pipelines) {
      if (!pipeline.event || !pipeline.steps || pipeline.steps.length === 0) {
        throw new Error(`Invalid pipeline: each pipeline must have an event and at least one step`)
      }
      for (const step of pipeline.steps) {
        if (!step.pluginId) {
          throw new Error(`Invalid step: each step must have a pluginId`)
        }
      }
    }

    // Get server config
    const existingConfigs = await ServerConfig.find({
      selectionSet: `{ serverName pluginPipelines }`
    })

    if (existingConfigs.length === 0) {
      throw new Error('No server config found')
    }

    const serverConfig = existingConfigs[0]

    // Update the pluginPipelines JSON field
    await ServerConfig.update({
      where: { serverName: serverConfig.serverName },
      update: {
        pluginPipelines: pipelines
      }
    })

    return pipelines
  }
}

export default getResolver
