import type { Driver } from "neo4j-driver";
import type { Channel, ServerConfig } from "../../ogm_types.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
export const CHANNEL_PIPELINE_DEFAULT_SELECTION = `{
  uniqueName
  displayName
  description
  locked
  lockReason
  deleted
  channelIconURL
  icon32Url
  icon48Url
  icon64Url
  icon96Url
  channelBannerURL
  eventsEnabled
  wikiEnabled
  feedbackEnabled
  downloadsEnabled
  emojiEnabled
  imageUploadsEnabled
  markdownImagesEnabled
  allowPaidDownloads
  allowPaywalledPosts
  requireVerifiedPhoneForUploads
  requireVerifiedEmailToPost
  markAsAnsweredEnabled
  discussionFlairRequired
  allowedFileTypes
  payoutPercent
  variantUrls
  rules
  pluginPipelines
  createdAt
  lockedAt
}`;
export const BOT_DEPRECATION_DEFAULT_SELECTION = `{
  username
  displayName
  pronouns
  location
  bio
  profilePicURL
  avatar32Url
  avatar48Url
  avatar64Url
  avatar96Url
  enableSensitiveContentByDefault
  isBot
  botProfileId
  isDeprecated
  deprecatedReason
  commentKarma
  discussionKarma
  stripeAccountId
  defaultEmojiSkinTone
  preferredTimeZone
  deleted
  notifyOnReplyToCommentByDefault
  notifyOnReplyToDiscussionByDefault
  notifyOnReplyToEventByDefault
  notifyWhenTagged
  notifyOnSubscribedIssueUpdates
  notifyOnFeedback
  notifyOnSuspensionBlocks
  notificationBundleInterval
  notificationBundleEnabled
  notificationBundleContent
  variantUrls
  createdAt
}`;
const CHANNEL = `query ChannelPipelineSettings($where: ChannelWhere) { channels(where: $where) {
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
      } }`;
const SERVER = `query ServerSettingsForChannelPipeline { serverConfigs {
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
        } }`;
const SAVE = `mutation SaveChannelPipelineSettings($where: ChannelWhere, $update: ChannelUpdateInput) { updateChannels(where: $where, update: $update) { channels ${CHANNEL_PIPELINE_DEFAULT_SELECTION} } }`;
const DEPRECATE = `mutation DeprecateOrphanedPipelineBot($where: UserWhere, $update: UserUpdateInput) { updateUsers(where: $where, update: $update) { users ${BOT_DEPRECATION_DEFAULT_SELECTION} } }`;
const DISCONNECT = `mutation DisconnectOrphanedPipelineBots($where: ChannelWhere, $disconnect: ChannelDisconnectInput) { updateChannels(where: $where, disconnect: $disconnect) { channels ${CHANNEL_PIPELINE_DEFAULT_SELECTION} } }`;
export interface ChannelPipelineRepository {
  findSettings(uniqueName: string): Promise<Channel[]>;
  savePipelines(uniqueName: string, pluginPipelines: string): Promise<void>;
  listServerSettings(): Promise<ServerConfig[]>;
  deprecateBot(username: string, reason: string): Promise<void>;
  disconnectBots(uniqueName: string, usernames: string[]): Promise<void>;
}
export function createChannelPipelineRepository(driver: Driver): ChannelPipelineRepository {
  return {
    async findSettings(uniqueName) {
      const data=await executeGeneratedOperation<{channels:Channel[]}>(driver,CHANNEL,{where:{uniqueName:{eq:uniqueName}}});return data.channels;
    },
    async savePipelines(uniqueName,pluginPipelines) {
      await executeGeneratedOperation(driver,SAVE,{where:{uniqueName:{eq:uniqueName}},update:{pluginPipelines:{set:pluginPipelines}}});
    },
    async listServerSettings() {
      const data=await executeGeneratedOperation<{serverConfigs:ServerConfig[]}>(driver,SERVER,{});return data.serverConfigs;
    },
    async deprecateBot(username,reason) {
      await executeGeneratedOperation(driver,DEPRECATE,{where:{username:{eq:username}},update:{isDeprecated:{set:true},deprecatedReason:{set:reason}}});
    },
    async disconnectBots(uniqueName,usernames) {
      await executeGeneratedOperation(driver,DISCONNECT,{where:{uniqueName:{eq:uniqueName}},disconnect:{Bots:usernames.map(username=>({where:{node:{username:{eq:username}}}}))}});
    },
  };
}
