import type {Channel,ServerConfig,User} from '../../src/generated/graphql.js';
import type {Projection,Selection} from './selection.js';
// Fixed schema-executed source shapes. JSON scalar contents remain unrestricted.
export const botIdentitySelection={username:true,isBot:true,botProfileId:true,isDeprecated:true,deprecatedReason:true} as const satisfies Selection<User>;
export type BotIdentityProjection=Projection<User,typeof botIdentitySelection>;
export const botChannelSelection={uniqueName:true,Bots:{username:true}} as const satisfies Selection<Channel>;
export type BotChannelProjection=Projection<Channel,typeof botChannelSelection>;
export const channelBotSettingsSelection={...botChannelSelection,EnabledPluginsConnection:{edges:{properties:{enabled:true,settingsJson:true},node:{settingsDefaults:true,Plugin:{name:true,tags:true}}}}} as const satisfies Selection<Channel>;
export type ChannelBotSettingsProjection=Projection<Channel,typeof channelBotSettingsSelection>;
export const serverBotSettingsSelection={serverName:true,InstalledVersionsConnection:{edges:{properties:{enabled:true,settingsJson:true},node:{version:true,settingsDefaults:true,Plugin:{name:true,tags:true}}}}} as const satisfies Selection<ServerConfig>;
export type ServerBotSettingsProjection=Projection<ServerConfig,typeof serverBotSettingsSelection>;
export const botUserWriteSelection={
  username:true, displayName:true, pronouns:true, location:true,
  bio:true, profilePicURL:true, avatar32Url:true, avatar48Url:true,
  avatar64Url:true, avatar96Url:true, enableSensitiveContentByDefault:true, isBot:true,
  botProfileId:true, isDeprecated:true, deprecatedReason:true, commentKarma:true,
  discussionKarma:true, stripeAccountId:true, defaultEmojiSkinTone:true, preferredTimeZone:true,
  deleted:true, notifyOnReplyToCommentByDefault:true, notifyOnReplyToDiscussionByDefault:true, notifyOnReplyToEventByDefault:true,
  notifyWhenTagged:true, notifyOnSubscribedIssueUpdates:true, notifyOnFeedback:true, notifyOnSuspensionBlocks:true,
  notificationBundleInterval:true, notificationBundleEnabled:true, notificationBundleContent:true, variantUrls:true,
  createdAt:true,
} as const satisfies Selection<User>;
export type BotUserWriteProjection=Projection<User,typeof botUserWriteSelection>;
export const botChannelWriteSelection={
  uniqueName:true, displayName:true, description:true, locked:true,
  lockReason:true, deleted:true, channelIconURL:true, icon32Url:true,
  icon48Url:true, icon64Url:true, icon96Url:true, channelBannerURL:true,
  eventsEnabled:true, wikiEnabled:true, feedbackEnabled:true, downloadsEnabled:true,
  emojiEnabled:true, imageUploadsEnabled:true, markdownImagesEnabled:true, allowPaidDownloads:true,
  allowPaywalledPosts:true, requireVerifiedPhoneForUploads:true, requireVerifiedEmailToPost:true, markAsAnsweredEnabled:true,
  discussionFlairRequired:true, allowedFileTypes:true, payoutPercent:true, variantUrls:true,
  rules:true, pluginPipelines:true, createdAt:true, lockedAt:true,
} as const satisfies Selection<Channel>;
export type BotChannelWriteProjection=Projection<Channel,typeof botChannelWriteSelection>;
