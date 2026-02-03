import { GraphQLResolveInfo } from 'graphql';
import {
  getBotNameFromSettings,
  getProfilesFromSettings,
  syncBotUsersForChannelProfiles
} from '../services/botUserService.js';
import { mergeSettings } from '../services/plugin/pipelineUtils.js';

interface UpdateChannelsArgs {
  where?: any;
  update?: any;
  [key: string]: any;
}

interface Context {
  ogm: any;
  driver: any;
  [key: string]: any;
}

const BOT_TAGS = new Set(['bot', 'bots']);

const parseSettingsJson = (settingsJson: any) => {
  if (!settingsJson || typeof settingsJson !== 'string') {
    return settingsJson || {};
  }
  try {
    return JSON.parse(settingsJson);
  } catch {
    return {};
  }
};

const isBotPlugin = (plugin: any) => {
  const tags = Array.isArray(plugin?.tags) ? plugin.tags : [];
  return tags.some((tag: any) => BOT_TAGS.has(String(tag).toLowerCase()));
};

const channelBotsMiddleware = {
  Mutation: {
    updateChannels: async (
      resolve: (parent: unknown, args: UpdateChannelsArgs, context: Context, info: GraphQLResolveInfo) => Promise<any>,
      parent: unknown,
      args: UpdateChannelsArgs,
      context: Context,
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

async function syncBotsForChannel(result: any, args: UpdateChannelsArgs, context: Context) {
  try {
    const channelUniqueName =
      args.where?.uniqueName || result?.updateChannels?.channels?.[0]?.uniqueName;

    if (!channelUniqueName) {
      return;
    }

    const { ogm } = context;
    const Channel = ogm.model('Channel');
    const User = ogm.model('User');

    const channels = await Channel.find({
      where: { uniqueName: channelUniqueName },
      selectionSet: `{
        uniqueName
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
    const edges = channel?.EnabledPluginsConnection?.edges || [];

    for (const edge of edges) {
      if (!edge?.properties) continue;
      if (!edge.properties.enabled) continue;
      if (!isBotPlugin(edge?.node?.Plugin)) continue;

      // Merge settingsDefaults from PluginVersion with channel-specific settings
      const settingsDefaults = parseSettingsJson(edge?.node?.settingsDefaults);
      const channelSettings = parseSettingsJson(edge.properties.settingsJson);

      // Channel settings override defaults; wrap in 'channel' key to match expected structure
      const channelSettingsWrapped = Object.keys(channelSettings).length > 0
        ? { channel: channelSettings }
        : {};
      const mergedSettings = mergeSettings(settingsDefaults, channelSettingsWrapped);

      console.log('🧩 Bot plugin settings (channel)', {
        channelUniqueName,
        pluginName: edge?.node?.Plugin?.name,
        pluginTags: edge?.node?.Plugin?.tags,
        settingsDefaults: JSON.stringify(settingsDefaults || null),
        channelSettings: JSON.stringify(channelSettings || null),
        mergedSettings: JSON.stringify(mergedSettings || null)
      });

      const botName = getBotNameFromSettings(mergedSettings);
      if (!botName) {
        console.warn('⚠️ Bot plugin has no botName in merged settings', {
          channelUniqueName,
          pluginName: edge?.node?.Plugin?.name,
          mergedSettings: JSON.stringify(mergedSettings || null)
        });
        continue;
      }

      const profiles = getProfilesFromSettings(mergedSettings);

      await syncBotUsersForChannelProfiles({
        User,
        Channel,
        channelUniqueName,
        botName,
        profiles
      });
    }
  } catch (error) {
    console.warn(
      'Failed to sync bot users after channel plugin update:',
      (error as any)?.message || error
    );
  }
}

export default channelBotsMiddleware;
