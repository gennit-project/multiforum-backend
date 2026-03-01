import type { ChannelModel, ServerConfigModel, UserModel } from '../../ogm_types.js'
import {
  buildBotUsername,
  getBotNameFromSettings,
  getProfilesFromSettings,
  syncBotUsersForChannelProfiles
} from '../../services/botUserService.js'
import { mergeSettings } from '../../services/plugin/pipelineUtils.js'
import { validatePipelines, type EventPipelineInput } from './updatePluginPipelines.js'

type Input = {
  Channel: ChannelModel
  ServerConfig: ServerConfigModel
  User: UserModel
  syncBotsForChannel?: typeof syncBotUsersForChannelProfiles
  getProfiles?: typeof getProfilesFromSettings
  getBotName?: typeof getBotNameFromSettings
}

type Args = {
  channelUniqueName: string
  pipelines: EventPipelineInput[]
}

// Valid events for channel-scoped pipelines
const VALID_CHANNEL_EVENTS = [
  'discussionChannel.created',
  'comment.created',
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

const parseSettingsJson = (settingsJson: any) => {
  if (!settingsJson || typeof settingsJson !== 'string') {
    return settingsJson || {}
  }
  try {
    return JSON.parse(settingsJson)
  } catch {
    return {}
  }
}

const getResolver = (input: Input) => {
  const { Channel, ServerConfig, User } = input
  const syncBotsForChannel = input.syncBotsForChannel || syncBotUsersForChannelProfiles
  const getProfiles = input.getProfiles || getProfilesFromSettings
  const getBotName = input.getBotName || getBotNameFromSettings
  const isBotPlugin = (plugin: any) => {
    const tags = Array.isArray(plugin?.tags) ? plugin.tags : []
    return tags.some((tag: any) => String(tag).toLowerCase() === 'bots' || String(tag).toLowerCase() === 'bot')
  }

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

    // Get the channel with its bots and enabled plugins
    const existingChannels = await Channel.find({
      where: { uniqueName: channelUniqueName },
      selectionSet: `{
        uniqueName
        pluginPipelines
        Bots {
          username
        }
        EnabledPluginsConnection {
          edges {
            properties {
              enabled
              settingsJson
            }
            node {
              settingsDefaults
              Plugin {
                name
                tags
              }
            }
          }
        }
      }`
    })

    if (existingChannels.length === 0) {
      throw new Error(`Channel "${channelUniqueName}" not found`)
    }

    const channel = existingChannels[0] as any

    // Update the pluginPipelines JSON field (serialized as string for Neo4j)
    await Channel.update({
      where: { uniqueName: channelUniqueName },
      update: {
        pluginPipelines: JSON.stringify(pipelines)
      }
    })

    try {
      // Fetch server-level plugin settings
      const serverConfigs = await ServerConfig.find({
        selectionSet: `{
          serverName
          InstalledVersionsConnection {
            edges {
              properties {
                enabled
                settingsJson
              }
              node {
                version
                settingsDefaults
                Plugin {
                  name
                  tags
                }
              }
            }
          }
        }`
      })

      const serverConfig = serverConfigs[0]
      const serverEdges = serverConfig?.InstalledVersionsConnection?.edges || []

      // Build a map of server-level settings by plugin name
      const serverSettingsMap = new Map<string, any>()
      for (const edge of serverEdges) {
        const pluginName = edge.node?.Plugin?.name
        if (pluginName && edge.properties?.enabled) {
          serverSettingsMap.set(pluginName, {
            settingsJson: parseSettingsJson(edge.properties.settingsJson),
            settingsDefaults: parseSettingsJson(edge.node.settingsDefaults)
          })
        }
      }

      const channelEdges = channel?.EnabledPluginsConnection?.edges || []

      // Collect ALL desired bot usernames across all enabled bot plugins
      const allDesiredBotUsernames = new Set<string>()

      for (const edge of channelEdges) {
        if (!edge?.properties?.enabled) continue
        if (!isBotPlugin(edge?.node?.Plugin)) continue

        const pluginName = edge?.node?.Plugin?.name

        // Get settings from all three levels
        const settingsDefaults = parseSettingsJson(edge?.node?.settingsDefaults)
        const serverData = serverSettingsMap.get(pluginName)
        const serverSettings = serverData?.settingsJson || {}
        const channelSettings = parseSettingsJson(edge.properties.settingsJson)

        // Merge settings: defaults < server (wrapped) < channel (wrapped)
        const serverSettingsWrapped = Object.keys(serverSettings).length > 0
          ? { server: serverSettings }
          : {}
        const channelSettingsWrapped = Object.keys(channelSettings).length > 0
          ? { channel: channelSettings }
          : {}

        const mergedSettings = mergeSettings(
          mergeSettings(settingsDefaults, serverSettingsWrapped),
          channelSettingsWrapped
        )

        const botName = getBotName(mergedSettings)
        if (!botName) continue

        const profiles = getProfiles(mergedSettings)

        // Calculate all desired usernames for this bot plugin
        const baseUsername = buildBotUsername(channelUniqueName, botName, null)
        allDesiredBotUsernames.add(baseUsername)

        for (const profile of profiles) {
          if (profile?.id) {
            const profileUsername = buildBotUsername(channelUniqueName, botName, profile.id)
            allDesiredBotUsernames.add(profileUsername)
          }
        }

        // Ensure bot users exist and are connected
        await syncBotsForChannel({
          User,
          Channel,
          channelUniqueName,
          botName,
          profiles
        })
      }

      // Disconnect any bot users that are NOT in the desired set
      const currentBots = (channel.Bots || []).map((bot: any) => bot.username)
      const botsToDisconnect = currentBots.filter(
        (username: string) => username.startsWith('bot-') && !allDesiredBotUsernames.has(username)
      )

      if (botsToDisconnect.length > 0) {
        console.log('🧹 Disconnecting orphaned bots from channel (pipeline update)', {
          channelUniqueName,
          botsToDisconnect,
          desiredBots: Array.from(allDesiredBotUsernames)
        })

        await Channel.update({
          where: { uniqueName: channelUniqueName },
          disconnect: {
            Bots: botsToDisconnect.map((username: string) => ({
              where: { node: { username } }
            }))
          }
        })
      }
    } catch (error) {
      console.warn(
        `Failed to sync bot users for channel ${channelUniqueName}:`,
        (error as any)?.message || error
      )
    }

    return pipelines
  }
}

export default getResolver
