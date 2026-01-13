import type { ChannelModel } from '../../ogm_types.js'
import { validatePipelines, type EventPipelineInput } from './updatePluginPipelines.js'

type Input = {
  Channel: ChannelModel
}

type Args = {
  channelUniqueName: string
  pipelines: EventPipelineInput[]
}

// Valid events for channel-scoped pipelines
const VALID_CHANNEL_EVENTS = [
  'discussionChannel.created',
]

/**
 * Validates that pipelines only use channel-scoped events.
 * Returns null if valid, or an error message string if invalid.
 */
const validateChannelEvents = (pipelines: EventPipelineInput[]): string | null => {
  for (const pipeline of pipelines) {
    if (!VALID_CHANNEL_EVENTS.includes(pipeline.event)) {
      return `Invalid event "${pipeline.event}" for channel pipeline. Valid events are: ${VALID_CHANNEL_EVENTS.join(', ')}`
    }
  }
  return null
}

const getResolver = (input: Input) => {
  const { Channel } = input

  return async (_parent: unknown, args: Args, _context: unknown, _resolveInfo: unknown) => {
    const { channelUniqueName, pipelines } = args

    if (!channelUniqueName) {
      throw new Error('channelUniqueName is required')
    }

    // Validate general pipeline structure
    const structureError = validatePipelines(pipelines)
    if (structureError) {
      throw new Error(structureError)
    }

    // Validate channel-specific event types
    const eventError = validateChannelEvents(pipelines)
    if (eventError) {
      throw new Error(eventError)
    }

    // Get the channel
    const existingChannels = await Channel.find({
      where: { uniqueName: channelUniqueName },
      selectionSet: `{ uniqueName pluginPipelines }`
    })

    if (existingChannels.length === 0) {
      throw new Error(`Channel "${channelUniqueName}" not found`)
    }

    // Update the pluginPipelines JSON field
    await Channel.update({
      where: { uniqueName: channelUniqueName },
      update: {
        pluginPipelines: pipelines
      }
    })

    return pipelines
  }
}

export default getResolver
