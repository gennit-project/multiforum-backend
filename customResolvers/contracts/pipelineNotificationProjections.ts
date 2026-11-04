import type {PluginPipelineRun,DownloadableFile,User} from '../../src/generated/graphql.js';
import type {Selection,Projection} from './selection.js';
export const pipelineNotificationAttemptSelection={pipelineId:true,targetId:true,targetType:true,status:true,notifiedAt:true} as const satisfies Selection<PluginPipelineRun>;
export const pipelineNotificationFileSelection={id:true,uploadedByUsername:true,Discussion:{id:true,title:true,Author:{username:true},DiscussionChannels:{channelUniqueName:true,archived:true}}} as const satisfies Selection<DownloadableFile>;
export type PipelineNotificationAttempt=Projection<PluginPipelineRun,typeof pipelineNotificationAttemptSelection>;
export type PipelineNotificationFile=Projection<DownloadableFile,typeof pipelineNotificationFileSelection>;
// Retain the post-commit default selection, including unused fields whose
// serialization errors historically propagate after a delivered notification.
export const notificationDeliveryUserSelection={
 username:true,displayName:true,pronouns:true,location:true,bio:true,profilePicURL:true,
 avatar32Url:true,avatar48Url:true,avatar64Url:true,avatar96Url:true,
 enableSensitiveContentByDefault:true,isBot:true,botProfileId:true,isDeprecated:true,deprecatedReason:true,
 commentKarma:true,discussionKarma:true,stripeAccountId:true,defaultEmojiSkinTone:true,preferredTimeZone:true,
 deleted:true,notifyOnReplyToCommentByDefault:true,notifyOnReplyToDiscussionByDefault:true,
 notifyOnReplyToEventByDefault:true,notifyWhenTagged:true,notifyOnSubscribedIssueUpdates:true,
 notifyOnFeedback:true,notifyOnSuspensionBlocks:true,notificationBundleInterval:true,
 notificationBundleEnabled:true,notificationBundleContent:true,variantUrls:true,createdAt:true,
} as const satisfies Selection<User>;
