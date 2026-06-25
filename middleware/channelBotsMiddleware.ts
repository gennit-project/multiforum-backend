import { GraphQLResolveInfo } from 'graphql';
import {
  buildBotUsername,
  getBotNameFromSettings,
  getProfilesFromSettings,
  syncBotUsersForChannelProfiles
} from '../services/botUserService.js';
import { mergeSettings } from '../services/plugin/pipelineUtils.js';
import type { GraphQLContext } from '../types/context.js';
import { logger } from "../logger.js";

interface UpdateChannelsArgs {
  where?: { uniqueName?: string; [key: string]: unknown };
  update?: { EnabledPlugins?: unknown; [key: string]: unknown };
  [key: string]: unknown;
}

interface UpdateChannelsResult {
  updateChannels?: {
    channels?: Array<{ uniqueName?: string }>;
  };
  [key: string]: unknown;
}

interface ServerPluginEdge {
  properties?: {
    enabled?: boolean;
    settingsJson?: string;
  };
  node?: {
    version?: string;
    settingsDefaults?: string;
    Plugin?: {
      name?: string;
      tags?: string[];
    };
  };
}

const BOT_TAGS = new Set(['bot', 'bots']);

export const parseSettingsJson = (settingsJson: unknown): Record<string, unknown> => {
  if (!settingsJson || typeof settingsJson !== 'string') {
    return (settingsJson as Record<string, unknown>) || {};
  }
  try {
    return JSON.parse(settingsJson);
  } catch {
    return {};
  }
};

export const isBotPlugin = (plugin: { tags?: unknown } | null | undefined) => {
  const tags = Array.isArray(plugin?.tags) ? plugin.tags : [];
  return tags.some((tag: unknown) => BOT_TAGS.has(String(tag).toLowerCase()));
};

const channelBotsMiddleware = {
  Mutation: {
    updateChannels: async (
      resolve: (parent: unknown, args: UpdateChannelsArgs, context: GraphQLContext, info: GraphQLResolveInfo) => Promise<UpdateChannelsResult>,
      parent: unknown,
      args: UpdateChannelsArgs,
      context: GraphQLContext,
      info: GraphQLResolveInfo
    ) => {
      const isUpdatingEnabledPlugins = Boolean(args.update?.EnabledPlugins);
      const result = await resolve(parent, args, context, info);

      if (isUpdatingEnabledPlugins) {
        await syncBotsForChannel(result, args, context);
      }

      return result;
    }
  }
};

async function syncBotsForChannel(result: UpdateChannelsResult, args: UpdateChannelsArgs, context: GraphQLContext) {
  try {
    const channelUniqueName =
      args.where?.uniqueName || result?.updateChannels?.channels?.[0]?.uniqueName;

    if (!channelUniqueName) {
      return;
    }

    const { ogm } = context;
    const Channel = ogm.model('Channel');
    const User = ogm.model('User');
    const ServerConfig = ogm.model('ServerConfig');

    // Fetch channel with its enabled plugins
    const channels = await Channel.find({
      where: { uniqueName: channelUniqueName },
      selectionSet: `{
        uniqueName
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
    });

    const channel = channels?.[0];
    if (!channel) {
      return;
    }

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
    });

    const serverConfig = serverConfigs?.[0];
    const serverEdges: ServerPluginEdge[] =
      (serverConfig?.InstalledVersionsConnection?.edges as unknown as ServerPluginEdge[]) || [];

    // Build a map of server-level settings by plugin name
    const serverSettingsMap = new Map<string, { settingsJson: Record<string, unknown>; settingsDefaults: Record<string, unknown> }>();
    for (const edge of serverEdges) {
      const pluginName = edge.node?.Plugin?.name;
      if (pluginName && edge.node && edge.properties?.enabled) {
        serverSettingsMap.set(pluginName, {
          settingsJson: parseSettingsJson(edge.properties.settingsJson),
          settingsDefaults: parseSettingsJson(edge.node.settingsDefaults)
        });
      }
    }

    const channelEdges = channel?.EnabledPluginsConnection?.edges || [];

    // Collect ALL desired bot usernames across all enabled bot plugins
    const allDesiredBotUsernames = new Set<string>();

    for (const edge of channelEdges) {
      if (!edge?.properties) continue;
      if (!edge.properties.enabled) continue;
      if (!isBotPlugin(edge?.node?.Plugin)) continue;

      const pluginName = edge?.node?.Plugin?.name;

      // Get settings from all three levels
      const settingsDefaults = parseSettingsJson(edge?.node?.settingsDefaults);
      const serverData = serverSettingsMap.get(pluginName || '');
      const serverSettings = serverData?.settingsJson || {};
      const channelSettings = parseSettingsJson(edge.properties.settingsJson);

      // Merge settings: defaults < server (wrapped) < channel (wrapped)
      // Server and channel settings are stored flat but need to be wrapped
      const serverSettingsWrapped = Object.keys(serverSettings).length > 0
        ? { server: serverSettings }
        : {};
      const channelSettingsWrapped = Object.keys(channelSettings).length > 0
        ? { channel: channelSettings }
        : {};

      const mergedSettings = mergeSettings(
        mergeSettings(settingsDefaults, serverSettingsWrapped),
        channelSettingsWrapped
      );

      logger.info('🧩 Bot plugin settings (channel middleware)', {
        channelUniqueName,
        pluginName,
        settingsDefaults: JSON.stringify(settingsDefaults || null),
        serverSettings: JSON.stringify(serverSettings || null),
        channelSettings: JSON.stringify(channelSettings || null),
        mergedSettings: JSON.stringify(mergedSettings || null)
      });

      const botName = getBotNameFromSettings(mergedSettings);
      if (!botName) {
        logger.warn('⚠️ Bot plugin has no botName in merged settings', {
          channelUniqueName,
          pluginName,
          mergedSettings: JSON.stringify(mergedSettings || null)
        });
        continue;
      }

      const profiles = getProfilesFromSettings(mergedSettings);

      // Calculate all desired usernames for this bot plugin (profile-specific only, no base bot)
      for (const profile of profiles) {
        if (profile?.id) {
          const profileUsername = buildBotUsername(channelUniqueName, botName, profile.id);
          allDesiredBotUsernames.add(profileUsername);
        }
      }

      // Ensure bot users exist and are connected
      await syncBotUsersForChannelProfiles({
        User,
        Channel,
        channelUniqueName,
        botName,
        profiles
      });
    }

    // Disconnect any bot users that are NOT in the desired set
    // This handles cleanup when bot names change or plugins are disabled
    const currentBots = (channel.Bots || []).map((bot: { username: string }) => bot.username);
    const botsToDisconnect = currentBots.filter(
      (username: string) => username.startsWith('bot-') && !allDesiredBotUsernames.has(username)
    );

    if (botsToDisconnect.length > 0) {
      logger.info('🧹 Marking orphaned bots as deprecated and disconnecting from channel', {
        channelUniqueName,
        botsToDisconnect,
        desiredBots: Array.from(allDesiredBotUsernames)
      });

      // Mark the bots as deprecated before disconnecting
      for (const username of botsToDisconnect) {
        await User.update({
          where: { username },
          update: {
            isDeprecated: true,
            deprecatedReason: `Bot profile removed from channel "${channelUniqueName}"`
          }
        });
      }

      // Disconnect the deprecated bots from the channel
      await Channel.update({
        where: { uniqueName: channelUniqueName },
        disconnect: {
          Bots: botsToDisconnect.map((username: string) => ({
            where: { node: { username } }
          }))
        }
      });
    }
  } catch (error) {
    logger.warn(
      'Failed to sync bot users after channel plugin update:',
      error instanceof Error ? error.message : error
    );
  }
}

export default channelBotsMiddleware;
